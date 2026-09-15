import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';
import * as paymentService from './paymentService.js';
import * as emailService from './emailService.js';
import * as shipmentsService from './shipmentsService.js';

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

function serialize(orderRow, items, shipmentRow, paymentRow, shipmentHistoryRows) {
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
    // status/trackingNumber se mantienen con el mismo nombre que antes de
    // agregar la línea de seguimiento, para no romper a nadie que ya los leía.
    shipment: shipmentsService.serializeShipment(shipmentRow, shipmentHistoryRows),
    payment: paymentRow ? { wompiTransactionId: paymentRow.wompi_transaction_id, status: paymentRow.status, paymentMethodType: paymentRow.payment_method_type } : null,
    createdAt: orderRow.created_at,
  };
}

// Métodos asíncronos (todo salvo CARD): Wompi no siempre trae la URL de
// redirección en la respuesta de creación — hay que consultarla, igual que
// etniapp-core (hasta 10 intentos cada 2s).
async function pollForRedirectUrl(wompiTransactionId) {
  for (let i = 0; i < 10; i++) {
    const tx = await paymentService.getTransactionById(wompiTransactionId);
    if (tx?.redirectUrl) return tx.redirectUrl;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

function mapOrderStatus(wompiStatus) {
  if (wompiStatus === 'APPROVED') return 'paid';
  if (wompiStatus === 'PENDING') return 'pending';
  return 'failed'; // DECLINED, VOIDED, ERROR
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
  // La comisión del dueño se lee aquí y se congela en order_items (ver migrate.js):
  // la liquidación histórica no debe cambiar si mañana se renegocia el porcentaje.
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.price, p.active, p.variant_stock, p.seller_id, s.commission_rate
     FROM products p LEFT JOIN sellers s ON s.id = p.seller_id
     WHERE p.id IN (?)`,
    [productIds]
  );
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
      sellerId: product.seller_id ?? null,
      commissionRate: product.seller_id == null ? null : Number(product.commission_rate),
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

  // El cobro ocurre ANTES de cualquier escritura en DB. A partir de aquí, igual que
  // etniapp-core: si Wompi ACEPTÓ la solicitud (2xx), la orden se persiste siempre,
  // sea el resultado APPROVED o DECLINED — el estado del cobro viaja en
  // payment_transactions/orders.status, no en si la orden existe o no. Solo una
  // falla real de Wompi (HTTP no-2xx, red caída, body ilegible) impide persistir.
  if (!paymentMethod || !paymentMethod.type) {
    throw new HttpError(400, { errors: ['paymentMethod.type es obligatorio.'] });
  }

  const charge = await paymentService.createTransaction({
    reference,
    amountInCents: Number(amountInCents),
    currency: 'COP',
    customerEmail: customerContact.email,
    paymentMethod,
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

    const orderStatus = mapOrderStatus(charge.status);
    const [orderResult] = await conn.query(
      `INSERT INTO orders (customer_id, reference, idempotency_key, status, subtotal, shipping_cost, total, shipping_name, shipping_email, shipping_phone, shipping_address, shipping_city, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, reference, idempotencyKey || null, orderStatus, subtotal, shippingCost, total, customerContact.fullName, customerContact.email, customerContact.phone, customerContact.address, customerContact.city, customerContact.notes || null]
    );
    orderId = orderResult.insertId;

    for (const line of resolvedLines) {
      await conn.query(
        'INSERT INTO order_items (order_id, product_id, product_name, color, size, quantity, unit_price, seller_id, commission_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [orderId, line.productId, line.productName, line.color, line.size, line.quantity, line.unitPrice, line.sellerId, line.commissionRate]
      );

      const fresh = freshById.get(line.productId);
      const variantStock = parseVariantStock(fresh);
      const updated = variantStock.map((v) =>
        v.color === line.color && v.size === line.size ? { ...v, stock: v.stock - line.quantity } : v
      );
      await conn.query('UPDATE products SET variant_stock = ? WHERE id = ?', [JSON.stringify(updated), line.productId]);
    }

    const [shipmentResult] = await conn.query('INSERT INTO shipments (order_id, status) VALUES (?, \'pending\')', [orderId]);
    await shipmentsService.appendInitialHistory(conn, shipmentResult.insertId);

    await conn.query(
      'INSERT INTO payment_transactions (order_id, wompi_transaction_id, status, amount_in_cents, currency, payment_method_type, raw_response) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [orderId, charge.wompiTransactionId, charge.status, charge.amountInCents, 'COP', paymentMethod.type, JSON.stringify(charge.raw)]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();

    // El pago ya fue aceptado por Wompi en este punto (p.ej. carrera de stock perdida
    // o error de DB) — se intenta un reverso automático antes de pedirle a soporte
    // que lo haga a mano. Un void solo es válido el mismo día/antes de conciliación;
    // si Wompi lo rechaza, cae al aviso de siempre con la referencia para reverso manual.
    let voided = false;
    try {
      await paymentService.voidTransaction(charge.wompiTransactionId);
      voided = true;
    } catch (voidErr) {
      console.error(JSON.stringify({ level: 'error', scope: 'wompi-void', reference, wompiTransactionId: charge.wompiTransactionId, message: voidErr.message }));
    }

    console.error(JSON.stringify({
      level: voided ? 'error-payment-reversed' : 'fatal-payment-orphan',
      reference,
      wompiTransactionId: charge.wompiTransactionId,
      amountInCents: charge.amountInCents,
      voided,
      message: err.message,
    }));

    if (voided) {
      throw new HttpError(409, {
        error: 'No pudimos confirmar tu pedido (el cobro fue revertido automáticamente, no se te cobró). Intenta de nuevo.',
        reference,
      });
    }
    throw new HttpError(500, {
      error: 'El pago se procesó pero no pudimos confirmar tu pedido. Contacta soporte con esta referencia.',
      reference,
      wompiTransactionId: charge.wompiTransactionId,
    });
  } finally {
    conn.release();
  }

  const order = await getForCustomer(customerId, orderId);

  // A diferencia de etniapp-core (que manda el correo de "confirmado" sin mirar el
  // estado del cobro), aquí solo se envía si Wompi aprobó de una — mandar "tu pedido
  // fue confirmado" sobre una tarjeta rechazada sería engañoso. Para métodos async
  // que quedan en PENDING, el correo se manda cuando el webhook confirme el pago
  // (ver wompiWebhookService.js), no aquí.
  if (charge.status === 'APPROVED') {
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
  }

  // Métodos async (PSE/Nequi/Bancolombia/DaviPlata): si Wompi no trajo la URL de
  // redirección en la respuesta de creación, se consulta por polling antes de
  // devolver la orden al cliente — este backend nunca expone el redirect_url
  // persistido, solo lo adjunta a esta respuesta puntual.
  let redirectUrl = charge.redirectUrl;
  if (!redirectUrl && paymentMethod.type !== 'CARD' && charge.status === 'PENDING') {
    redirectUrl = await pollForRedirectUrl(charge.wompiTransactionId);
  }

  return redirectUrl ? { ...order, redirectUrl } : order;
}

// Llamado por el webhook de Wompi (wompiWebhookService.js) cuando llega un
// transaction.updated para un método async que quedó en PENDING al crear la orden.
// Solo manda el correo de confirmación en la transición hacia 'paid' (no en cada
// webhook repetido de Wompi, que puede reenviar el mismo evento).
export async function applyPaymentUpdate(wompiTransactionId, wompiStatus, rawTransaction) {
  const [rows] = await pool.query(
    `SELECT pt.order_id, pt.status AS previous_status, o.customer_id
     FROM payment_transactions pt JOIN orders o ON o.id = pt.order_id
     WHERE pt.wompi_transaction_id = ?`,
    [wompiTransactionId]
  );
  const row = rows[0];
  if (!row) return null; // transacción de otra app/ambiente, o no registrada todavía — se ignora

  const newOrderStatus = mapOrderStatus(wompiStatus);
  await pool.query('UPDATE payment_transactions SET status = ?, raw_response = ? WHERE wompi_transaction_id = ?', [wompiStatus, JSON.stringify(rawTransaction), wompiTransactionId]);
  await pool.query('UPDATE orders SET status = ? WHERE id = ?', [newOrderStatus, row.order_id]);

  if (newOrderStatus === 'paid' && row.previous_status !== 'APPROVED') {
    const order = await getForCustomer(row.customer_id, row.order_id);
    try {
      await emailService.sendOrderConfirmation({
        to: order.shippingContact.email,
        fullName: order.shippingContact.fullName,
        reference: order.reference,
        items: order.items,
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        total: order.total,
      });
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', scope: 'email', reference: order.reference, message: err.message }));
    }
  }

  return { orderId: row.order_id, status: newOrderStatus };
}

// Antes hacía 1 + 3N queries (una por pedido, vía getForCustomer). Con muchos
// pedidos por cliente eso escala mal, así que aquí se trae todo en 5 queries
// totales (la quinta es el historial de la línea de seguimiento) y se agrupa
// en JS — la forma de la respuesta no cambia salvo por el nuevo shipment.history.
export async function listForCustomer(customerId) {
  const [orders] = await pool.query('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', [customerId]);
  if (orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const [items] = await pool.query('SELECT * FROM order_items WHERE order_id IN (?)', [orderIds]);
  const [shipments] = await pool.query('SELECT * FROM shipments WHERE order_id IN (?)', [orderIds]);
  const [payments] = await pool.query('SELECT * FROM payment_transactions WHERE order_id IN (?)', [orderIds]);

  const shipmentIds = shipments.map((s) => s.id);
  const [history] =
    shipmentIds.length > 0
      ? await pool.query('SELECT * FROM shipment_status_history WHERE shipment_id IN (?) ORDER BY created_at ASC', [shipmentIds])
      : [[]];

  const itemsByOrder = new Map();
  for (const it of items) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push(it);
  }
  const shipmentByOrder = new Map(shipments.map((s) => [s.order_id, s]));
  const historyByShipment = new Map();
  for (const h of history) {
    if (!historyByShipment.has(h.shipment_id)) historyByShipment.set(h.shipment_id, []);
    historyByShipment.get(h.shipment_id).push(h);
  }
  const paymentByOrder = new Map(payments.map((p) => [p.order_id, p]));

  return orders.map((order) => {
    const shipment = shipmentByOrder.get(order.id);
    return serialize(order, itemsByOrder.get(order.id) || [], shipment, paymentByOrder.get(order.id), shipment && historyByShipment.get(shipment.id));
  });
}

export async function getForCustomer(customerId, orderId) {
  const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? AND customer_id = ?', [orderId, customerId]);
  const order = orders[0];
  if (!order) throw new HttpError(404, 'Pedido no encontrado.');

  const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  const [shipments] = await pool.query('SELECT * FROM shipments WHERE order_id = ?', [order.id]);
  const [payments] = await pool.query('SELECT * FROM payment_transactions WHERE order_id = ?', [order.id]);
  const shipment = shipments[0];
  const [history] = shipment
    ? await pool.query('SELECT * FROM shipment_status_history WHERE shipment_id = ? ORDER BY created_at ASC', [shipment.id])
    : [[]];

  return serialize(order, items, shipment, payments[0], history);
}
