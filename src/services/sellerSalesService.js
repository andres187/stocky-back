import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

// Solo cuentan las órdenes pagadas: una declinada existe como fila (ver ordersService)
// pero no se le debe plata a nadie por ella.
const PAID_ONLY = "o.status = 'paid'";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Devuelve [sqlExtra, params] para un rango opcional de fechas sobre orders.created_at.
// `to` es inclusivo: se compara contra el día siguiente.
function dateRange({ from, to } = {}) {
  const parts = [];
  const params = [];
  if (from) {
    if (!DATE_RE.test(from)) throw new HttpError(400, 'La fecha "desde" debe tener formato AAAA-MM-DD.');
    parts.push('o.created_at >= ?');
    params.push(from);
  }
  if (to) {
    if (!DATE_RE.test(to)) throw new HttpError(400, 'La fecha "hasta" debe tener formato AAAA-MM-DD.');
    parts.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(to);
  }
  return [parts.length > 0 ? ' AND ' + parts.join(' AND ') : '', params];
}

// La comisión sale del snapshot en order_items, no de sellers.commission_rate:
// si mañana se renegocia el %, las ventas viejas se liquidan con el que tenían.
const GROSS = 'oi.quantity * oi.unit_price';
const COMMISSION = `ROUND(${GROSS} * COALESCE(oi.commission_rate, 0) / 100)`;

export async function listForSeller(sellerId, range) {
  const [extra, params] = dateRange(range);
  const [rows] = await pool.query(
    `SELECT oi.*, o.reference, o.created_at AS order_date, o.status AS order_status,
            ${GROSS} AS gross, ${COMMISSION} AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.seller_id = ? AND ${PAID_ONLY}${extra}
     ORDER BY o.created_at DESC`,
    [sellerId, ...params]
  );

  const items = rows.map((r) => ({
    orderId: r.order_id,
    reference: r.reference,
    date: r.order_date,
    productId: r.product_id,
    productName: r.product_name,
    color: r.color,
    size: r.size,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    commissionRate: r.commission_rate == null ? 0 : Number(r.commission_rate),
    gross: Number(r.gross),
    commission: Number(r.commission),
    payout: Number(r.gross) - Number(r.commission),
  }));

  return {
    items,
    totals: items.reduce(
      (acc, it) => ({
        units: acc.units + it.quantity,
        gross: acc.gross + it.gross,
        commission: acc.commission + it.commission,
        payout: acc.payout + it.payout,
      }),
      { units: 0, gross: 0, commission: 0, payout: 0 }
    ),
  };
}

// Liquidación para el admin: una fila por dueño con lo vendido, la comisión de la
// tienda y lo que hay que pagarle.
export async function summaryForAdmin(range) {
  const [extra, params] = dateRange(range);
  const [rows] = await pool.query(
    `SELECT s.id AS seller_id, s.full_name, s.email, s.commission_rate AS current_rate,
            COUNT(DISTINCT o.id) AS order_count,
            SUM(oi.quantity) AS units,
            SUM(${GROSS}) AS gross,
            SUM(${COMMISSION}) AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN sellers s ON s.id = oi.seller_id
     WHERE ${PAID_ONLY}${extra}
     GROUP BY s.id
     ORDER BY gross DESC`,
    params
  );

  const sellers = rows.map((r) => ({
    sellerId: r.seller_id,
    fullName: r.full_name,
    email: r.email,
    currentCommissionRate: Number(r.current_rate),
    orderCount: Number(r.order_count),
    units: Number(r.units),
    gross: Number(r.gross),
    commission: Number(r.commission),
    payout: Number(r.gross) - Number(r.commission),
  }));

  return {
    sellers,
    totals: sellers.reduce(
      (acc, s) => ({
        units: acc.units + s.units,
        gross: acc.gross + s.gross,
        commission: acc.commission + s.commission,
        payout: acc.payout + s.payout,
      }),
      { units: 0, gross: 0, commission: 0, payout: 0 }
    ),
  };
}
