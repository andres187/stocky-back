import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

export async function list() {
  const [rows] = await pool.query('SELECT * FROM sizes ORDER BY sort_order ASC, label ASC');
  return rows.map((r) => ({ id: r.id, label: r.label, sortOrder: r.sort_order }));
}

export async function create(label) {
  if (!label || !label.trim()) throw new HttpError(400, 'La talla es obligatoria.');

  const [existing] = await pool.query('SELECT id FROM sizes WHERE label = ?', [label.trim()]);
  if (existing.length > 0) throw new HttpError(409, 'Esa talla ya existe.');

  const [[{ maxOrder }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM sizes');
  const [result] = await pool.query('INSERT INTO sizes (label, sort_order) VALUES (?, ?)', [label.trim(), maxOrder + 1]);

  return { id: result.insertId, label: label.trim(), sortOrder: maxOrder + 1 };
}

export async function update(id, label) {
  if (!label || !label.trim()) throw new HttpError(400, 'La talla es obligatoria.');

  const [[current]] = await pool.query('SELECT * FROM sizes WHERE id = ?', [id]);
  if (!current) throw new HttpError(404, 'Talla no encontrada.');

  await pool.query('UPDATE sizes SET label = ? WHERE id = ?', [label.trim(), id]);
  return { id: current.id, label: label.trim(), sortOrder: current.sort_order };
}

export async function remove(id) {
  const [result] = await pool.query('DELETE FROM sizes WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Talla no encontrada.');
}
