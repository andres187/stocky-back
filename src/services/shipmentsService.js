import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

// Flujo normal del envío, en orden. 'pending' significa "pagado, aún sin
// preparar" (así lo crea ordersService.checkout). 'received' es la confirmación
// del comprador y es lo que arranca la retención de pago al vendedor.
// cancelled/returned son estados terminales de excepción, no un paso más.
export const STATUS_FLOW = ['pending', 'preparing', 'shipped', 'out_for_delivery', 'delivered', 'received'];
export const TERMINAL_STATUSES = ['cancelled', 'returned'];
export const ALL_STATUSES = [...STATUS_FLOW, ...TERMINAL_STATUSES];

// Quién puede confirmar que el pedido llegó. El vendedor queda fuera a
// propósito: "entregado" ya lo pone él, que es la parte interesada, y dejarlo
// también cerrar el "recibido" haría que pudiera liberar su propio pago.
const CAN_CONFIRM_RECEIPT = ['customer', 'system', 'admin'];

// Solo se puede avanzar dentro del flujo (no retroceder), cancelar antes de
// que llegue, o marcar devuelto una vez que salió a reparto / se entregó /
// el cliente lo recibió. Desde un estado terminal no se sale.
export function canTransition(from, to, actorType) {
  if (TERMINAL_STATUSES.includes(from)) return false;
  if (to === 'cancelled') return from !== 'delivered' && from !== 'received';
  if (to === 'returned') return from === 'out_for_delivery' || from === 'delivered' || from === 'received';
  if (to === 'received' && !CAN_CONFIRM_RECEIPT.includes(actorType)) return false;
  const fromIdx = STATUS_FLOW.indexOf(from);
  const toIdx = STATUS_FLOW.indexOf(to);
  return fromIdx !== -1 && toIdx !== -1 && toIdx === fromIdx + 1;
}

function serializeHistory(rows) {
  return rows.map((r) => ({ status: r.status, note: r.note, createdAt: r.created_at }));
}

export function serializeShipment(row, historyRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    deliveredAt: row.delivered_at ?? null,
    receivedAt: row.received_at ?? null,
    receivedSource: row.received_source ?? null,
    updatedAt: row.updated_at,
    history: serializeHistory(historyRows),
  };
}

// Usado desde ordersService en el momento en que un pedido queda pagado (tanto
// en el camino síncrono de checkout() como en el async de applyPaymentUpdate()),
// para que la línea de seguimiento siempre arranque con al menos un paso.
// Recibe la misma conexión de la transacción del caller.
export async function appendInitialHistory(conn, shipmentId, status = 'pending') {
  await conn.query(
    "INSERT INTO shipment_status_history (shipment_id, status, actor_type) VALUES (?, ?, 'system')",
    [shipmentId, status]
  );
}

async function getShipmentWithHistory(shipmentId, queryable = pool) {
  const [rows] = await queryable.query('SELECT * FROM shipments WHERE id = ?', [shipmentId]);
  const shipment = rows[0];
  if (!shipment) return null;
  const [history] = await queryable.query(
    'SELECT * FROM shipment_status_history WHERE shipment_id = ? ORDER BY created_at ASC',
    [shipmentId]
  );
  return { shipment, history };
}

// actor = { type: 'admin' | 'seller' | 'customer' | 'system', id }. Todo en una
// transacción: se bloquea la fila del envío, se valida la transición contra su
// estado actual y quién la pide, y solo entonces se actualiza + se agrega el
// paso al historial.
export async function updateStatus(shipmentId, { status, trackingNumber, carrier, note, receivedSource }, actor) {
  if (!ALL_STATUSES.includes(status)) {
    throw new HttpError(400, { errors: [`El estado debe ser uno de: ${ALL_STATUSES.join(', ')}.`] });
  }

  const actorType = actor?.type || 'system';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM shipments WHERE id = ? FOR UPDATE', [shipmentId]);
    const current = rows[0];
    if (!current) throw new HttpError(404, 'Envío no encontrado.');

    if (!canTransition(current.status, status, actorType)) {
      throw new HttpError(409, { errors: [`No se puede pasar de "${current.status}" a "${status}".`] });
    }

    // delivered_at/received_at quedan desnormalizados aquí porque la
    // liquidación los consulta en cada reporte (ver PAYOUT_STATE_SQL) y no
    // puede estar re-derivándolos del historial fila por fila.
    const extraSets = [];
    const extraParams = [];
    if (status === 'delivered' && !current.delivered_at) {
      extraSets.push('delivered_at = NOW()');
    }
    if (status === 'received' && !current.received_at) {
      extraSets.push('received_at = NOW()', 'received_source = ?');
      extraParams.push(receivedSource || (actorType === 'system' ? 'auto' : actorType));
    }

    await conn.query(
      `UPDATE shipments SET status = ?, tracking_number = ?, carrier = ?${extraSets.length ? ', ' + extraSets.join(', ') : ''} WHERE id = ?`,
      [status, trackingNumber ?? current.tracking_number, carrier ?? current.carrier, ...extraParams, shipmentId]
    );
    await conn.query(
      'INSERT INTO shipment_status_history (shipment_id, status, note, actor_type, actor_id) VALUES (?, ?, ?, ?, ?)',
      [shipmentId, status, note || null, actorType, actor?.id ?? null]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const { shipment, history } = await getShipmentWithHistory(shipmentId);
  return serializeShipment(shipment, history);
}

// Panel admin: lista de envíos con la referencia del pedido y el contacto de
// envío, para no obligar a abrir cada pedido por separado.
export async function listForAdmin({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE sh.status = ?';
    params.push(status);
  }
  const [rows] = await pool.query(
    `SELECT sh.*, o.reference, o.shipping_name, o.shipping_city, o.created_at AS order_created_at
     FROM shipments sh
     JOIN orders o ON o.id = sh.order_id
     ${where}
     ORDER BY sh.updated_at DESC`,
    params
  );
  return rows.map((r) => ({
    ...serializeShipment(r),
    orderReference: r.reference,
    shippingName: r.shipping_name,
    shippingCity: r.shipping_city,
    orderCreatedAt: r.order_created_at,
  }));
}

// Portal del vendedor: solo envíos de pedidos que incluyan al menos una prenda
// suya, y solo si el pedido ya está pagado (antes de eso no hay nada que
// despachar).
export async function listForSeller(sellerId, { status } = {}) {
  const params = [sellerId];
  let extra = '';
  if (status) {
    extra = 'AND sh.status = ?';
    params.push(status);
  }
  const [rows] = await pool.query(
    `SELECT DISTINCT sh.*, o.reference, o.shipping_name, o.shipping_city, o.created_at AS order_created_at
     FROM shipments sh
     JOIN orders o ON o.id = sh.order_id
     JOIN order_items oi ON oi.order_id = o.id
     WHERE oi.seller_id = ? AND o.status = 'paid' ${extra}
     ORDER BY sh.updated_at DESC`,
    params
  );
  return rows.map((r) => ({
    ...serializeShipment(r),
    orderReference: r.reference,
    shippingName: r.shipping_name,
    shippingCity: r.shipping_city,
    orderCreatedAt: r.order_created_at,
  }));
}

// 404 (no 403) si el envío no es suyo: no queremos confirmarle a un vendedor
// que un ID de envío existe si ninguna de sus prendas está en ese pedido.
export async function assertSellerOwnsShipment(sellerId, shipmentId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM shipments sh
     JOIN order_items oi ON oi.order_id = sh.order_id
     WHERE sh.id = ? AND oi.seller_id = ? LIMIT 1`,
    [shipmentId, sellerId]
  );
  if (rows.length === 0) throw new HttpError(404, 'Envío no encontrado.');
}
