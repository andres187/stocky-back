import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';
import { PAID_ONLY, GROSS, COMMISSION, PAYOUT_STATE_SQL, PAYOUT_STATE_JOINS } from './reportsService.js';

function serializePayout(row, items = []) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.full_name ?? null,
    amount: row.amount,
    note: row.note,
    createdAt: row.created_at,
    items: items.map((it) => ({
      orderItemId: it.order_item_id,
      orderId: it.order_id ?? null,
      reference: it.reference ?? null,
      productName: it.product_name ?? null,
      gross: it.gross,
      commission: it.commission,
      payout: it.gross - it.commission,
    })),
  };
}

// Las ventas de un vendedor que ya cumplieron la retención y no están
// bloqueadas: es exactamente lo que se le puede pagar hoy.
export async function listAvailableForSeller(sellerId) {
  const [rows] = await pool.query(
    `SELECT oi.id AS order_item_id, oi.order_id, oi.product_name, oi.quantity,
            o.reference, sh.received_at,
            ${GROSS} AS gross, ${COMMISSION} AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     ${PAYOUT_STATE_JOINS}
     WHERE oi.seller_id = ? AND ${PAID_ONLY} AND ${PAYOUT_STATE_SQL} = 'available'
     ORDER BY o.created_at ASC`,
    [sellerId]
  );

  const items = rows.map((r) => ({
    orderItemId: r.order_item_id,
    orderId: r.order_id,
    reference: r.reference,
    productName: r.product_name,
    quantity: r.quantity,
    receivedAt: r.received_at,
    gross: Number(r.gross),
    commission: Number(r.commission),
    payout: Number(r.gross) - Number(r.commission),
  }));

  return { items, total: items.reduce((sum, it) => sum + it.payout, 0) };
}

// Registra un pago al vendedor. El punto entero de esta función es no pagar dos
// veces lo mismo: se re-verifica dentro de la transacción que cada ítem siga
// 'available' (con FOR UPDATE, para que dos admins simultáneos se serialicen),
// y el UNIQUE sobre seller_payout_items.order_item_id es la red que no se
// puede saltar aunque la verificación fallara.
export async function create(sellerId, { orderItemIds, note }, adminId) {
  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
    throw new HttpError(400, { errors: ['Debes indicar al menos una venta a pagar.'] });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT oi.id AS order_item_id, ${GROSS} AS gross, ${COMMISSION} AS commission,
              ${PAYOUT_STATE_SQL} AS payout_state
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       ${PAYOUT_STATE_JOINS}
       WHERE oi.id IN (?) AND oi.seller_id = ? AND ${PAID_ONLY}
       FOR UPDATE`,
      [orderItemIds, sellerId]
    );

    if (rows.length !== orderItemIds.length) {
      throw new HttpError(404, 'Alguna de las ventas no existe o no es de este vendedor.');
    }

    const notAvailable = rows.filter((r) => r.payout_state !== 'available');
    if (notAvailable.length > 0) {
      throw new HttpError(409, {
        error: 'Algunas ventas ya no se pueden pagar (ya pagadas, retenidas o con devolución). Recarga y vuelve a intentar.',
        orderItemIds: notAvailable.map((r) => r.order_item_id),
      });
    }

    const amount = rows.reduce((sum, r) => sum + (Number(r.gross) - Number(r.commission)), 0);

    const [result] = await conn.query(
      'INSERT INTO seller_payouts (seller_id, amount, note, paid_by) VALUES (?, ?, ?, ?)',
      [sellerId, amount, note || null, adminId ?? null]
    );
    const payoutId = result.insertId;

    for (const r of rows) {
      await conn.query(
        'INSERT INTO seller_payout_items (payout_id, order_item_id, gross, commission) VALUES (?, ?, ?, ?)',
        [payoutId, r.order_item_id, Number(r.gross), Number(r.commission)]
      );
    }

    await conn.commit();
    return getById(payoutId);
  } catch (err) {
    await conn.rollback();
    // Si dos pagos coincidieron exactamente, el UNIQUE lo corta aquí.
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Alguna de estas ventas ya fue pagada. Recarga y vuelve a intentar.');
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function getById(payoutId) {
  const [rows] = await pool.query(
    `SELECT p.*, s.full_name FROM seller_payouts p
     JOIN sellers s ON s.id = p.seller_id WHERE p.id = ?`,
    [payoutId]
  );
  if (!rows[0]) throw new HttpError(404, 'Pago no encontrado.');

  const [items] = await pool.query(
    `SELECT spi.*, oi.order_id, oi.product_name, o.reference
     FROM seller_payout_items spi
     JOIN order_items oi ON oi.id = spi.order_item_id
     JOIN orders o ON o.id = oi.order_id
     WHERE spi.payout_id = ?`,
    [payoutId]
  );

  return serializePayout(rows[0], items);
}

export async function listForAdmin({ sellerId } = {}) {
  const params = [];
  let where = '';
  if (sellerId) {
    where = 'WHERE p.seller_id = ?';
    params.push(sellerId);
  }
  const [rows] = await pool.query(
    `SELECT p.*, s.full_name FROM seller_payouts p
     JOIN sellers s ON s.id = p.seller_id
     ${where}
     ORDER BY p.created_at DESC`,
    params
  );
  return rows.map((r) => serializePayout(r));
}

export async function listForSeller(sellerId) {
  const [rows] = await pool.query(
    `SELECT p.*, s.full_name FROM seller_payouts p
     JOIN sellers s ON s.id = p.seller_id
     WHERE p.seller_id = ?
     ORDER BY p.created_at DESC`,
    [sellerId]
  );
  return rows.map((r) => serializePayout(r));
}
