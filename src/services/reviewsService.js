import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

function serialize(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productImage: row.image_url,
    orderId: row.order_id,
    rating: row.rating,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_WITH_PRODUCT = `
  SELECT pr.*, p.name AS product_name, p.image_url
  FROM product_reviews pr
  JOIN products p ON p.id = pr.product_id
`;

function validatePayload(body) {
  const errors = [];
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push('La calificación debe ser un número entero entre 1 y 5.');
  }
  if (body.body != null && String(body.body).length > 1000) {
    errors.push('El comentario no puede superar los 1000 caracteres.');
  }
  if (errors.length > 0) throw new HttpError(400, { errors });
}

// Resuelve el pedido pagado más reciente del cliente que incluya ese producto,
// para marcar el comentario como "compra verificada". Si no hay ninguno, el
// comentario igual se permite (queda con order_id = null) — no todo comentario
// tiene por qué venir de una compra hecha en esta tienda.
async function findVerifiedOrderId(customerId, productId) {
  const [rows] = await pool.query(
    `SELECT o.id FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.customer_id = ? AND oi.product_id = ? AND o.status = 'paid'
     ORDER BY o.created_at DESC LIMIT 1`,
    [customerId, productId]
  );
  return rows[0]?.id ?? null;
}

export async function listForCustomer(customerId) {
  const [rows] = await pool.query(`${SELECT_WITH_PRODUCT} WHERE pr.customer_id = ? ORDER BY pr.created_at DESC`, [customerId]);
  return rows.map(serialize);
}

export async function listForProduct(productId) {
  const [rows] = await pool.query(
    `${SELECT_WITH_PRODUCT} WHERE pr.product_id = ? AND pr.status = 'published' ORDER BY pr.created_at DESC`,
    [productId]
  );
  return rows.map(serialize);
}

export async function create(customerId, payload) {
  validatePayload(payload);

  const productId = Number(payload.productId);
  const [products] = await pool.query('SELECT id FROM products WHERE id = ?', [productId]);
  if (products.length === 0) throw new HttpError(400, { errors: ['El producto no existe.'] });

  const [existing] = await pool.query('SELECT id FROM product_reviews WHERE customer_id = ? AND product_id = ?', [customerId, productId]);
  if (existing.length > 0) throw new HttpError(409, 'Ya dejaste un comentario para este producto.');

  const orderId = await findVerifiedOrderId(customerId, productId);
  const [result] = await pool.query(
    'INSERT INTO product_reviews (customer_id, product_id, order_id, rating, body) VALUES (?, ?, ?, ?, ?)',
    [customerId, productId, orderId, Number(payload.rating), payload.body || null]
  );

  const [rows] = await pool.query(`${SELECT_WITH_PRODUCT} WHERE pr.id = ?`, [result.insertId]);
  return serialize(rows[0]);
}

async function getOwnRow(customerId, id) {
  const [rows] = await pool.query('SELECT * FROM product_reviews WHERE id = ? AND customer_id = ?', [id, customerId]);
  if (rows.length === 0) throw new HttpError(404, 'Comentario no encontrado.');
  return rows[0];
}

export async function update(customerId, id, payload) {
  await getOwnRow(customerId, id);
  validatePayload(payload);

  await pool.query('UPDATE product_reviews SET rating = ?, body = ? WHERE id = ? AND customer_id = ?', [
    Number(payload.rating),
    payload.body || null,
    id,
    customerId,
  ]);

  const [rows] = await pool.query(`${SELECT_WITH_PRODUCT} WHERE pr.id = ?`, [id]);
  return serialize(rows[0]);
}

export async function remove(customerId, id) {
  await getOwnRow(customerId, id);
  await pool.query('DELETE FROM product_reviews WHERE id = ? AND customer_id = ?', [id, customerId]);
}
