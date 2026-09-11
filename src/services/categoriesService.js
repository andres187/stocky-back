import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function serialize(row) {
  return { id: row.id, key: row.slug, label: row.label, sortOrder: row.sort_order };
}

export async function list() {
  const [rows] = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC, label ASC');
  return rows.map(serialize);
}

export async function create(label) {
  if (!label || !label.trim()) throw new HttpError(400, 'El nombre de la categoría es obligatorio.');

  const slug = slugify(label);
  const [existing] = await pool.query('SELECT id FROM categories WHERE slug = ?', [slug]);
  if (existing.length > 0) throw new HttpError(409, 'Ya existe una categoría con ese nombre.');

  const [[{ maxOrder }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM categories');
  const [result] = await pool.query('INSERT INTO categories (slug, label, sort_order) VALUES (?, ?, ?)', [slug, label.trim(), maxOrder + 1]);

  return { id: result.insertId, key: slug, label: label.trim(), sortOrder: maxOrder + 1 };
}

export async function update(id, label) {
  if (!label || !label.trim()) throw new HttpError(400, 'El nombre de la categoría es obligatorio.');

  const [[current]] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
  if (!current) throw new HttpError(404, 'Categoría no encontrada.');

  await pool.query('UPDATE categories SET label = ? WHERE id = ?', [label.trim(), id]);
  return { id: current.id, key: current.slug, label: label.trim(), sortOrder: current.sort_order };
}

export async function remove(id) {
  try {
    const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw new HttpError(404, 'Categoría no encontrada.');
  } catch (err) {
    // La FK products.category -> categories.slug (ON DELETE RESTRICT) rechaza el borrado
    // si hay productos usándola — sin condición de carrera, lo garantiza la base de datos.
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
      throw new HttpError(409, 'No se puede eliminar: hay productos usando esta categoría.');
    }
    throw err;
  }
}
