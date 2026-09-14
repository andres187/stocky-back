import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

// Todas las lecturas salen por aquí para que `sellerName` (el nombre del dueño de la
// ropa) venga siempre resuelto. seller_id NULL = producto de la tienda.
const SELECT_BASE = `
  SELECT p.*, s.full_name AS seller_name
  FROM products p
  LEFT JOIN sellers s ON s.id = p.seller_id
`;

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
    sellerId: row.seller_id ?? null,
    sellerName: row.seller_name ?? null,
  };
}

// allowCuration: solo el admin cura la vitrina (bestsellerOrder) y reasigna el dueño
// (sellerId). Desde el portal del vendedor esos campos se ignoran, no se validan.
async function validatePayload(body, { allowCuration = true } = {}) {
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
  if (allowCuration && body.bestsellerOrder != null && (!Number.isInteger(Number(body.bestsellerOrder)) || Number(body.bestsellerOrder) < 1)) {
    errors.push('El orden de best seller debe ser un número entero positivo.');
  }
  if (allowCuration && body.sellerId != null && body.sellerId !== '') {
    if (!Number.isInteger(Number(body.sellerId))) {
      errors.push('El dueño seleccionado no es válido.');
    } else {
      const [rows] = await pool.query('SELECT id FROM sellers WHERE id = ?', [body.sellerId]);
      if (rows.length === 0) errors.push('El dueño seleccionado no existe.');
    }
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

// Columnas escribibles, en el mismo orden que los INSERT/UPDATE de abajo.
function toColumns(payload, { bestsellerOrder, sellerId }) {
  const { name, cat, desc, price, oldPrice, img, badge, colors, sizes, active, variantStock } = payload;
  return [
    name, cat, desc || '', price, oldPrice || null, img, badge || null,
    JSON.stringify(colors), JSON.stringify(sizes), active === false ? 0 : 1,
    bestsellerOrder, JSON.stringify(variantStock || []), sellerId,
  ];
}

async function insertProduct(payload, curated) {
  const [result] = await pool.query(
    `INSERT INTO products (name, category, description, price, old_price, image_url, badge, colors, sizes, active, bestseller_order, variant_stock, seller_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    toColumns(payload, curated)
  );
  return getById(result.insertId);
}

export async function listPublic(categoria) {
  let sql = SELECT_BASE + ' WHERE p.active = 1';
  const params = [];

  if (categoria && categoria !== 'todo') {
    if (categoria === 'nuevo') {
      sql += ' AND p.badge = "new"';
    } else if (categoria === 'ofertas') {
      sql += ' AND p.old_price IS NOT NULL';
    } else {
      sql += ' AND p.category = ?';
      params.push(categoria);
    }
  }
  sql += ' ORDER BY p.created_at DESC';

  const [rows] = await pool.query(sql, params);
  return rows.map(serialize);
}

export async function listAdmin() {
  const [rows] = await pool.query(SELECT_BASE + ' ORDER BY p.created_at DESC');
  return rows.map(serialize);
}

export async function getById(id) {
  const [rows] = await pool.query(SELECT_BASE + ' WHERE p.id = ?', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Producto no encontrado.');
  return serialize(rows[0]);
}

export async function create(payload) {
  await validatePayload(payload);
  return insertProduct(payload, {
    bestsellerOrder: payload.bestsellerOrder || null,
    sellerId: payload.sellerId || null,
  });
}

export async function update(id, payload) {
  await validatePayload(payload);

  const [result] = await pool.query(
    `UPDATE products SET name=?, category=?, description=?, price=?, old_price=?, image_url=?, badge=?, colors=?, sizes=?, active=?, bestseller_order=?, variant_stock=?, seller_id=?
     WHERE id=?`,
    [...toColumns(payload, { bestsellerOrder: payload.bestsellerOrder || null, sellerId: payload.sellerId || null }), id]
  );

  if (result.affectedRows === 0) throw new HttpError(404, 'Producto no encontrado.');
  return getById(id);
}

export async function remove(id) {
  const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Producto no encontrado.');
}

// --- Portal del dueño ---------------------------------------------------------
// Todo lo de abajo filtra por seller_id y responde 404 (no 403) cuando el producto
// existe pero es de otro dueño: misma política que getForCustomer en ordersService,
// un 403 confirmaría que ese id existe.

export async function listForSeller(sellerId) {
  const [rows] = await pool.query(SELECT_BASE + ' WHERE p.seller_id = ? ORDER BY p.created_at DESC', [sellerId]);
  return rows.map(serialize);
}

export async function getForSeller(sellerId, id) {
  const [rows] = await pool.query(SELECT_BASE + ' WHERE p.id = ? AND p.seller_id = ?', [id, sellerId]);
  if (rows.length === 0) throw new HttpError(404, 'Producto no encontrado.');
  return serialize(rows[0]);
}

export async function createForSeller(sellerId, payload) {
  await validatePayload(payload, { allowCuration: false });
  return insertProduct(payload, { bestsellerOrder: null, sellerId });
}

export async function updateForSeller(sellerId, id, payload) {
  await validatePayload(payload, { allowCuration: false });

  // bestseller_order y seller_id quedan fuera del UPDATE: el dueño no puede ponerse
  // en la vitrina ni pasarle su producto a otro.
  const [result] = await pool.query(
    `UPDATE products SET name=?, category=?, description=?, price=?, old_price=?, image_url=?, badge=?, colors=?, sizes=?, active=?, variant_stock=?
     WHERE id=? AND seller_id=?`,
    [
      payload.name, payload.cat, payload.desc || '', payload.price, payload.oldPrice || null,
      payload.img, payload.badge || null, JSON.stringify(payload.colors), JSON.stringify(payload.sizes),
      payload.active === false ? 0 : 1, JSON.stringify(payload.variantStock || []),
      id, sellerId,
    ]
  );

  if (result.affectedRows === 0) {
    // Puede ser que no exista o que sea de otro dueño; el cliente no debe poder
    // distinguir los dos casos.
    await getForSeller(sellerId, id);
  }
  return getForSeller(sellerId, id);
}

export async function removeForSeller(sellerId, id) {
  const [result] = await pool.query('DELETE FROM products WHERE id = ? AND seller_id = ?', [id, sellerId]);
  if (result.affectedRows === 0) throw new HttpError(404, 'Producto no encontrado.');
}
