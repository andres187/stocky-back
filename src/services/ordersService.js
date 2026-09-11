import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';
import * as paymentService from './paymentService.js';
import * as emailService from './emailService.js';

// Réplica server-side de web/src/lib/shipping.js — no se importa entre los dos
// proyectos (son deployables separados), así que ambas copias deben mantenerse
// sincronizadas a mano si la regla de envío cambia.
const FREE_SHIPPING_THRESHOLD = 250000;
const SHIPPING_COST = 15000;
function shippingFor(subtotal) {
  return subtotal >= FREE_SHIPPING_THRESHOLD || subtotal === 0 ? 0 : SHIPPING_COST;
}

function parseVariantStock(row) {
  return row.variant_stock ? (typeof row.variant_stock === 'string' ? JSON.parse(row.variant_stock) : row.variant_stock) : [];
}

function serialize(orderRow, items, shipmentRow, paymentRow) {
  return {
    id: orderRow.id,
    reference: orderRow.reference,
    status: orderRow.status,
    subtotal: orderRow.subtotal,
    shippingCost: orderRow.shipping_cost,
    total: orderRow.total,
    shippingContact: {
      fullName: orderRow.shipping_name,
      email: orderRow.shipping_email,
      phone: orderRow.shipping_phone,
      address: orderRow.shipping_address,
      city: orderRow.shipping_city,
      notes: orderRow.notes,
    },
    items: items.map((it) => ({
      productId: it.product_id,
      productName: it.product_name,
      color: it.color,
      size: it.size,
      quantity: it.quantity,
      unitPrice: it.unit_price,
    })),
    shipment: shipmentRow ? { status: shipmentRow.status, trackingNumber: shipmentRow.tracking_number } : null,
    payment: paymentRow ? { wompiTransactionId: paymentRow.wompi_transaction_id, status: paymentRow.status } : null,
    createdAt: orderRow.created_at,
  };
}

async function buildOrderFromLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new HttpError(400, { errors: ['El pedido no puede estar vacío.'] });
  }
  for (const line of lines) {
    if (!line.productId || !line.color || !line.size || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw new HttpError(400, { errors: ['Cada línea necesita productId, color, size y una cantidad entera positiva.'] });
    }
  }

  const productIds = [...new Set(lines.map((l) => Number(l.productId)))];
  const [rows] = await pool.query('SELECT id, name, price, active, variant_stock FROM products WHERE id IN (?)', [productIds]);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const resolvedLines = [];
  for (const line of lines) {
    const product = byId.get(Number(line.productId));
    if (!product || !product.active) {
      throw new HttpError(400, { errors: [`El producto ${line.productId} no existe o no está disponible.`] });
    }
    const variantStock = parseVariantStock(product);
    const variant = variantStock.find((v) => v.color === line.color && v.size === line.size);
    if (!variant || variant.stock < Number(line.quantity)) {
      throw new HttpError(409, { errors: [`No hay stock suficiente de "${product.name}" (${line.color}, ${line.size}).`] });
    }
    resolvedLines.push({
      productId: product.id,
      productName: product.name,
      color: line.color,
      size: line.size,
      quantity: Number(line.quantity),
      unitPrice: product.price,
    });
  }

  const subtotal = resolvedLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const shippingCost = shippingFor(subtotal);
  const total = subtotal + shippingCost;

  return { resolvedLines, subtotal, shippingCost, total };
}

async function findByIdempotencyKey(customerId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const [rows] = await pool.query('SELECT id FROM orders WHERE customer_id = ? AND idempotency_key = ?', [customerId, idempotencyKey]);
  if (rows.length === 0) return null;
  return getForCustomer(customerId, rows[0].id);
}

export async function checkout(customerId, customerContact, lines, amountInCents, paymentMethod, idempotencyKey) {
  const existing = await findByIdempotencyKey(customerId, idempotencyKey);
  if (existing) return existing;

  const { resolvedLines, subtotal, shippingCost, total } = await buildOrderFromLines(lines);

  if (Number(amountInCents) !== Math.round(total * 100)) {
    throw new HttpError(409, 'El monto no coincide con el total calculado.');
  }

  const reference = 'STK-' + crypto.randomUUID();

  // El cobro ocurre ANTES de cualquier escritura en DB: si Wompi rechaza o falla,
  // no se crea ninguna fila de orden. Esta es la propiedad central del flujo.
  const charge = await paymentService.chargeCard({
    reference,
    amountInCents: Number(amountInCents),
    currency: 'COP',
    customerEmail: customerContact.email,
    cardPaymentMethod: paymentMethod,
  });

  const conn = await pool.getConnection();
  let orderId;
  try {
    await conn.beginTransaction();

    // Re-chequeo de stock dentro de la transacción: cierra la carrera entre el
    // pre-check optimista de buildOrderFromLines y este momento.
    const productIds = [...new Set(resolvedLines.map((l) => l.productId))];
    const [freshRows] = await conn.query('SELECT id, variant_stock FROM products WHERE id IN (?) FOR UPDATE', [productIds]);
    const freshById = new Map(freshRows.map((r) => [r.id, r]));

    for (const line of resolvedLines) {
      const fresh = freshById.get(line.productId);
      const variantStock = parseVariantStock(fresh);
      const variant = variantStock.find((v) => v.color === line.color && v.size === line.size);
      if (!variant || variant.stock < line.quantity) {
        throw new Error(`STOCK_RACE:${line.productId}:${line.color}:${line.size}`);
      }
    }

    const [orderResult] = await conn.query(
      `INSERT INTO orders (customer_id, reference, idempotency_key, status, subtotal, shipping_cost, total, shipping_name, shipping_email, shipping_phone, shipping_address, shipping_city, notes)
       VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, reference, idempotencyKey || null, subtotal, shippingCost, total, customerContact.fullName, customerContact.email, customerContact.phone, customerContact.address, customerContact.city, customerContact.notes || null]
    );
    orderId = orderResult.insertId;

    for (const line of resolvedLines) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, product_name, color, size, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, line.productId, line.productName, line.color, line.size, line.quantity, line.unitPrice]
      );

      const fresh = freshById.get(line.productId);
      const variantStock = parseVariantStock(fresh);
      const updated = variantStock.map((v) =>
        v.color === line.color && v.size === line.size ? { ...v, stock: v.stock - line.quantity } : v
      );
      await conn.query('UPDATE products SET variant_stock = ? WHERE id = ?', [JSON.stringify(updated), line.productId]);
    }

    await conn.query('INSERT INTO shipments (order_id, status) VALUES (?, \'pending\')', [orderId]);

    await conn.query(
      'INSERT INTO payment_transactions (order_id, wompi_transaction_id, status, amount_in_cents, currency, payment_method_type, raw_response) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [orderId, charge.wompiTransactionId, charge.status, charge.amountInCents, 'COP', 'CARD', JSON.stringify(charge.raw)]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    // El pago ya fue capturado por Wompi en este punto: requiere reverso manual.
    console.error(JSON.stringify({
      level: 'fatal-payment-orphan',
      reference,
      wompiTransactionId: charge.wompiTransactionId,
      amountInCents: charge.amountInCents,
      message: err.message,
    }));
    throw new HttpError(500, {
      error: 'El pago se procesó pero no pudimos confirmar tu pedido. Contacta soporte con esta referencia.',
      reference,
      wompiTransactionId: charge.wompiTransactionId,
    });
  } finally {
    conn.release();
  }

  const order = await getForCustomer(customerId, orderId);

  try {
    await emailService.sendOrderConfirmation({
      to: customerContact.email,
      fullName: customerContact.fullName,
      reference,
      items: order.items,
      subtotal,
      shippingCost,
      total,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', scope: 'email', reference, message: err.message }));
  }

  return order;
}

export async function listForCustomer(customerId) {
  const [orders] = await pool.query('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', [customerId]);
  const results = [];
  for (const order of orders) {
    results.push(await getForCustomer(customerId, order.id));
  }
  return results;
}

export async function getForCustomer(customerId, orderId) {
  const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? AND customer_id = ?', [orderId, customerId]);
  const order = orders[0];
  if (!order) throw new HttpError(404, 'Pedido no encontrado.');

  const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  const [shipments] = await pool.query('SELECT * FROM shipments WHERE order_id = ?', [order.id]);
  const [payments] = await pool.query('SELECT * FROM payment_transactions WHERE order_id = ?', [order.id]);

  return serialize(order, items, shipments[0], payments[0]);
}
