import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

function validateHex(hex) {
  return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex);
}

function validate(name, hex) {
  if (!name || !name.trim()) throw new HttpError(400, 'El nombre del color es obligatorio.');
  if (!validateHex(hex)) throw new HttpError(400, 'El color debe ser un hex válido, ej. #d59aa2.');
}

export async function list() {
  const [rows] = await pool.query('SELECT * FROM colors ORDER BY name ASC');
  return rows.map((r) => ({ id: r.id, name: r.name, hex: r.hex }));
}

export async function create(name, hex) {
  validate(name, hex);

  const [existing] = await pool.query('SELECT id FROM colors WHERE name = ?', [name.trim()]);
  if (existing.length > 0) throw new HttpError(409, 'Ya existe un color con ese nombre.');

  const [result] = await pool.query('INSERT INTO colors (name, hex) VALUES (?, ?)', [name.trim(), hex]);
  return { id: result.insertId, name: name.trim(), hex };
}

export async function update(id, name, hex) {
  validate(name, hex);

  const [result] = await pool.query('UPDATE colors SET name = ?, hex = ? WHERE id = ?', [name.trim(), hex, id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Color no encontrado.');
  return { id: Number(id), name: name.trim(), hex };
}

export async function remove(id) {
  const [result] = await pool.query('DELETE FROM colors WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Color no encontrado.');
}
