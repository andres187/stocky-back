import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

const VALID_STATUSES = ['pending', 'shipped', 'delivered'];

export async function updateStatus(shipmentId, { status, trackingNumber }) {
  if (!VALID_STATUSES.includes(status)) {
    throw new HttpError(400, { errors: [`El estado debe ser uno de: ${VALID_STATUSES.join(', ')}.`] });
  }

  const [result] = await pool.query(
    'UPDATE shipments SET status = ?, tracking_number = ? WHERE id = ?',
    [status, trackingNumber || null, shipmentId]
  );
  if (result.affectedRows === 0) throw new HttpError(404, 'Envío no encontrado.');

  const [rows] = await pool.query('SELECT * FROM shipments WHERE id = ?', [shipmentId]);
  return { id: rows[0].id, orderId: rows[0].order_id, status: rows[0].status, trackingNumber: rows[0].tracking_number };
}
