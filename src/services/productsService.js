import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    cat: row.category,
    desc: row.description,
    price: row.price,
    oldPrice: row.old_price,
    img: row.image_url,
    badge: row.badge,
    colors: typeof row.colors === 'string' ? JSON.parse(row.colors) : row.colors,
    sizes: typeof row.sizes === 'string' ? JSON.parse(row.sizes) : row.sizes,
    active: !!row.active,
    bestsellerOrder: row.bestseller_order,
    variantStock: row.variant_stock ? (typeof row.variant_stock === 'string' ? JSON.parse(row.variant_stock) : row.variant_stock) : [],
  };
}

async function validatePayload(body) {
  const errors = [];
  if (!body.name || !body.name.trim()) errors.push('El nombre es obligatorio.');
  if (!body.cat || !body.cat.trim()) {
    errors.push('La categoría es obligatoria.');
  } else {
    const [rows] = await pool.query('SELECT id FROM categories WHERE slug = ?', [body.cat]);
    if (rows.length === 0) errors.push('La categoría seleccionada no existe.');
  }
  if (!Number.isFinite(Number(body.price)) || Number(body.price) <= 0) errors.push('El precio debe ser mayor a 0.');
  if (body.oldPrice != null && Number(body.oldPrice) <= Number(body.price)) errors.push('El precio de oferta debe ser mayor al precio actual.');
  if (!body.img || !body.img.trim()) errors.push('La URL de la imagen es obligatoria.');
  if (body.badge && !['new', 'low'].includes(body.badge)) errors.push('El distintivo debe ser "new", "low" o vacío.');
  if (!Array.isArray(body.colors) || body.colors.length === 0) errors.push('Agrega al menos un color.');
  if (!Array.isArray(body.sizes) || body.sizes.length === 0) errors.push('Agrega al menos una talla.');
  if (body.bestsellerOrder != null && (!Number.isInteger(Number(body.bestsellerOrder)) || Number(body.bestsellerOrder) < 1)) {
    errors.push('El orden de best seller debe ser un número entero positivo.');
  }
  if (body.variantStock != null) {
    if (!Array.isArray(body.variantStock)) {
      errors.push('El stock por combinación debe ser una lista.');
    } else {
      for (const v of body.variantStock) {
        if (!v.color || !v.size || !Number.isInteger(Number(v.stock)) || Number(v.stock) < 0) {
          errors.push('Cada combinación de color y talla necesita una cantidad entera mayor o igual a 0.');
          break;
        }
      }
    }
  }
  if (errors.length > 0) throw new HttpError(400, { errors });
}

export async function listPublic(categoria) {
  let sql = 'SELECT * FROM products WHERE active = 1';
  const params = [];

  if (categoria && categoria !== 'todo') {
    if (categoria === 'nuevo') {
      sql += ' AND badge = "new"';
    } else if (categoria === 'ofertas') {
      sql += ' AND old_price IS NOT NULL';
    } else {
      sql += ' AND category = ?';
      params.push(categoria);
    }
  }
  sql += ' ORDER BY created_at DESC';

  const [rows] = await pool.query(sql, params);
  return rows.map(serialize);
}

export async function listAdmin() {
  const [rows] = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
  return rows.map(serialize);
}

export async function getById(id) {
  const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Producto no encontrado.');
  return serialize(rows[0]);
}

export async function create(payload) {
  await validatePayload(payload);
  const { name, cat, desc, price, oldPrice, img, badge, colors, sizes, active, bestsellerOrder, variantStock } = payload;

  const [result] = await pool.query(
    `INSERT INTO products (name, category, description, price, old_price, image_url, badge, colors, sizes, active, bestseller_order, variant_stock)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, cat, desc || '', price, oldPrice || null, img, badge || null, JSON.stringify(colors), JSON.stringify(sizes), active === false ? 0 : 1, bestsellerOrder || null, JSON.stringify(variantStock || [])]
  );

  return getById(result.insertId);
}

export async function update(id, payload) {
  await validatePayload(payload);
  const { name, cat, desc, price, oldPrice, img, badge, colors, sizes, active, bestsellerOrder, variantStock } = payload;

  const [result] = await pool.query(
    `UPDATE products SET name=?, category=?, description=?, price=?, old_price=?, image_url=?, badge=?, colors=?, sizes=?, active=?, bestseller_order=?, variant_stock=?
     WHERE id=?`,
    [name, cat, desc || '', price, oldPrice || null, img, badge || null, JSON.stringify(colors), JSON.stringify(sizes), active === false ? 0 : 1, bestsellerOrder || null, JSON.stringify(variantStock || []), id]
  );

  if (result.affectedRows === 0) throw new HttpError(404, 'Producto no encontrado.');
  return getById(id);
}

export async function remove(id) {
  const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Producto no encontrado.');
}
