import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';
import { RECEIPT_HOLD_DAYS } from './reportsService.js';
import * as emailService from './emailService.js';

export const RETURN_REASONS = ['no_llego', 'danado', 'no_corresponde', 'talla', 'otro'];

// Solo se puede pedir devolución sobre un pedido que ya llegó. 'delivered' se
// acepta además de 'received' para no castigar al cliente al que le llegó rota
// la prenda y pide la devolución antes de darle a "ya lo recibí".
const RETURNABLE_SHIPMENT_STATUSES = ['delivered', 'received'];

function serialize(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    reference: row.reference ?? null,
    reason: row.reason,
    body: row.body,
    status: row.status,
    resolutionNote: row.resolution_note,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_WITH_ORDER = `
  SELECT rr.*, o.reference
  FROM return_requests rr
  JOIN orders o ON o.id = rr.order_id
`;

// El plazo corre desde que se confirmó el recibido. Si todavía no se confirmó
// (el envío está en 'delivered' y el cliente no ha dado clic), la ventana ni
// siquiera ha empezado, así que está dentro de plazo por definición.
function deadlineFor(receivedAt) {
  if (!receivedAt) return null;
  const deadline = new Date(receivedAt);
  deadline.setDate(deadline.getDate() + RECEIPT_HOLD_DAYS);
  return deadline;
}

export async function createForCustomer(customerId, orderId, { reason, body }) {
  const errors = [];
  if (!RETURN_REASONS.includes(reason)) {
    errors.push(`El motivo debe ser uno de: ${RETURN_REASONS.join(', ')}.`);
  }
  if (body != null && String(body).length > 1000) {
    errors.push('La descripción no puede superar los 1000 caracteres.');
  }
  if (errors.length > 0) throw new HttpError(400, { errors });

  // 404 y no 403 si el pedido no es suyo: mismo patrón anti-enumeración que
  // ordersService.getForCustomer y reviewsService.
  const [rows] = await pool.query(
    `SELECT o.id, o.status AS order_status, sh.status AS shipment_status, sh.received_at
     FROM orders o
     LEFT JOIN shipments sh ON sh.order_id = o.id
     WHERE o.id = ? AND o.customer_id = ?`,
    [orderId, customerId]
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, 'Pedido no encontrado.');

  if (order.order_status !== 'paid') {
    throw new HttpError(409, 'Solo se puede pedir la devolución de un pedido pagado.');
  }
  if (!RETURNABLE_SHIPMENT_STATUSES.includes(order.shipment_status)) {
    throw new HttpError(409, 'Solo se puede pedir la devolución de un pedido que ya llegó.');
  }

  const deadline = deadlineFor(order.received_at);
  if (deadline && Date.now() > deadline.getTime()) {
    throw new HttpError(409, `El plazo para pedir una devolución es de ${RECEIPT_HOLD_DAYS} días desde que confirmaste que recibiste el pedido, y ya venció.`);
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO return_requests (order_id, customer_id, reason, body) VALUES (?, ?, ?, ?)',
      [orderId, customerId, reason, body || null]
    );
    return getForCustomer(customerId, result.insertId);
  } catch (err) {
    // UNIQUE(order_id): ya hay una solicitud para este pedido.
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Ya existe una solicitud de devolución para este pedido.');
    }
    throw err;
  }
}

export async function listForCustomer(customerId) {
  const [rows] = await pool.query(`${SELECT_WITH_ORDER} WHERE rr.customer_id = ? ORDER BY rr.created_at DESC`, [customerId]);
  return rows.map(serialize);
}

export async function getForCustomer(customerId, id) {
  const [rows] = await pool.query(`${SELECT_WITH_ORDER} WHERE rr.id = ? AND rr.customer_id = ?`, [id, customerId]);
  if (!rows[0]) throw new HttpError(404, 'Solicitud no encontrada.');
  return serialize(rows[0]);
}

export async function getForCustomerByOrder(customerId, orderId) {
  const [rows] = await pool.query(`${SELECT_WITH_ORDER} WHERE rr.order_id = ? AND rr.customer_id = ?`, [orderId, customerId]);
  return rows[0] ? serialize(rows[0]) : null;
}

export async function cancelForCustomer(customerId, id) {
  const [result] = await pool.query(
    "UPDATE return_requests SET status = 'cancelled' WHERE id = ? AND customer_id = ? AND status = 'pending'",
    [id, customerId]
  );
  if (result.affectedRows === 0) {
    // O no es suya, o ya la resolvió el admin. No se distingue: en el segundo
    // caso el cliente igual verá el estado real al recargar.
    throw new HttpError(404, 'Solicitud no encontrada o ya resuelta.');
  }
  return getForCustomer(customerId, id);
}

export async function listForAdmin({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE rr.status = ?';
    params.push(status);
  }
  const [rows] = await pool.query(
    `SELECT rr.*, o.reference, o.total, o.shipping_name, c.email AS customer_email
     FROM return_requests rr
     JOIN orders o ON o.id = rr.order_id
     JOIN customers c ON c.id = rr.customer_id
     ${where}
     ORDER BY rr.created_at DESC`,
    params
  );
  return rows.map((r) => ({
    ...serialize(r),
    total: r.total,
    shippingName: r.shipping_name,
    customerEmail: r.customer_email,
  }));
}

// Aprobar NO mueve el envío a 'returned' a propósito: autorizar la devolución y
// recibir la prenda de vuelta son dos momentos distintos. El panel de envíos ya
// sabe pasar a 'returned' cuando la prenda efectivamente regrese.
export async function resolve(id, { status, resolutionNote }, adminId) {
  if (status !== 'approved' && status !== 'rejected') {
    throw new HttpError(400, { errors: ['El estado debe ser "approved" o "rejected".'] });
  }

  const [result] = await pool.query(
    "UPDATE return_requests SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ? AND status = 'pending'",
    [status, resolutionNote || null, adminId ?? null, id]
  );
  if (result.affectedRows === 0) {
    throw new HttpError(409, 'La solicitud no existe o ya fue resuelta.');
  }

  const [rows] = await pool.query(
    `SELECT rr.*, o.reference, c.email AS customer_email, c.full_name AS customer_full_name
     FROM return_requests rr
     JOIN orders o ON o.id = rr.order_id
     JOIN customers c ON c.id = rr.customer_id
     WHERE rr.id = ?`,
    [id]
  );
  const row = rows[0];

  try {
    await emailService.sendReturnResolved({
      to: row.customer_email,
      fullName: row.customer_full_name,
      reference: row.reference,
      status: row.status,
      resolutionNote: row.resolution_note,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', scope: 'email', reference: row.reference, message: err.message }));
  }

  return serialize(row);
}
