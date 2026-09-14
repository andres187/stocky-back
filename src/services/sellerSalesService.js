import { pool } from '../db/pool.js';
import { PAID_ONLY, dateRange, GROSS, COMMISSION } from './reportsService.js';

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
