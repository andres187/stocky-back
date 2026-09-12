import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

const STATUSES = ['pending', 'approved', 'rejected'];

function serialize(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    commissionRate: Number(row.commission_rate),
    status: row.status,
    productCount: Number(row.product_count ?? 0),
    createdAt: row.created_at,
  };
}

export async function list() {
  const [rows] = await pool.query(`
    SELECT s.*, COUNT(p.id) AS product_count
    FROM sellers s
    LEFT JOIN products p ON p.seller_id = s.id
    GROUP BY s.id
    ORDER BY FIELD(s.status, 'pending', 'approved', 'rejected'), s.created_at DESC
  `);
  return rows.map(serialize);
}

export async function getById(id) {
  const [rows] = await pool.query('SELECT * FROM sellers WHERE id = ?', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Dueño no encontrado.');
  return serialize(rows[0]);
}

// PATCH parcial: solo toca los campos presentes en el body (aprobar sin tener que
// reenviar la comisión, o cambiar la comisión sin tocar el estado).
export async function update(id, { status, commissionRate }) {
  const errors = [];
  if (status !== undefined && !STATUSES.includes(status)) {
    errors.push('El estado debe ser "pending", "approved" o "rejected".');
  }
  if (commissionRate !== undefined) {
    const rate = Number(commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      errors.push('La comisión debe ser un número entre 0 y 100.');
    }
  }
  if (status === undefined && commissionRate === undefined) {
    errors.push('No hay nada que actualizar.');
  }
  if (errors.length > 0) throw new HttpError(400, { errors });

  const sets = [];
  const params = [];
  if (status !== undefined) { sets.push('status = ?'); params.push(status); }
  if (commissionRate !== undefined) { sets.push('commission_rate = ?'); params.push(Number(commissionRate)); }

  const [result] = await pool.query(`UPDATE sellers SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  if (result.affectedRows === 0) await getById(id); // 404 si no existe; si existe, era un no-op
  return getById(id);
}

export async function remove(id) {
  try {
    const [result] = await pool.query('DELETE FROM sellers WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw new HttpError(404, 'Dueño no encontrado.');
  } catch (err) {
    // La FK products.seller_id -> sellers.id (ON DELETE RESTRICT) rechaza el borrado
    // si le quedan productos: lo garantiza la base de datos, no un conteo previo.
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
      throw new HttpError(409, 'No se puede eliminar: este dueño todavía tiene productos en el catálogo.');
    }
    throw err;
  }
}
