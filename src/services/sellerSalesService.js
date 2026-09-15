import { pool } from '../db/pool.js';
import { PAID_ONLY, dateRange, GROSS, COMMISSION, PAYOUT_STATE_SQL, PAYOUT_STATE_JOINS } from './reportsService.js';

// Los cinco estados en que puede estar una venta de cara al pago al vendedor.
// Ver PAYOUT_STATE_SQL en reportsService.js para cómo se derivan.
export const PAYOUT_STATES = ['pending', 'on_hold', 'available', 'paid', 'blocked'];

function emptyByState() {
  return Object.fromEntries(PAYOUT_STATES.map((s) => [s, 0]));
}

// Parte el total a pagar según el estado de cada venta, para que tanto el
// vendedor como el admin vean *por qué* algo todavía no se paga en vez de un
// único número que no distingue entre "aún no llega" y "ya se pagó".
function splitByState(items) {
  const byState = emptyByState();
  for (const it of items) byState[it.payoutState] += it.payout;
  return byState;
}

export async function listForSeller(sellerId, range) {
  const [extra, params] = dateRange(range);
  const [rows] = await pool.query(
    `SELECT oi.*, o.reference, o.created_at AS order_date, o.status AS order_status,
            sh.status AS shipment_status, sh.received_at,
            ${GROSS} AS gross, ${COMMISSION} AS commission,
            ${PAYOUT_STATE_SQL} AS payout_state
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     ${PAYOUT_STATE_JOINS}
     WHERE oi.seller_id = ? AND ${PAID_ONLY}${extra}
     ORDER BY o.created_at DESC`,
    [sellerId, ...params]
  );

  const items = rows.map((r) => ({
    orderItemId: r.id,
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
    payoutState: r.payout_state,
    shipmentStatus: r.shipment_status,
    receivedAt: r.received_at,
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
    byState: splitByState(items),
  };
}

// Liquidación para el admin: una fila por dueño con lo vendido, la comisión de la
// tienda y lo que hay que pagarle, partido por estado. `payout` sigue siendo el
// total histórico; `byState.available` es lo que de verdad se le puede pagar hoy.
export async function summaryForAdmin(range) {
  const [extra, params] = dateRange(range);

  // Dos consultas a propósito. Los totales van agrupados solo por vendedor:
  // COUNT(DISTINCT o.id) no se puede sumar entre grupos (un pedido con ítems en
  // dos estados distintos se contaría dos veces), así que el conteo de pedidos
  // se saca aquí y el desglose por estado en la segunda.
  const [totalRows] = await pool.query(
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

  const [stateRows] = await pool.query(
    `SELECT oi.seller_id, ${PAYOUT_STATE_SQL} AS payout_state,
            SUM(${GROSS}) AS gross, SUM(${COMMISSION}) AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     ${PAYOUT_STATE_JOINS}
     WHERE ${PAID_ONLY}${extra}
     GROUP BY oi.seller_id, payout_state`,
    params
  );

  const statesBySeller = new Map();
  for (const r of stateRows) {
    if (!statesBySeller.has(r.seller_id)) statesBySeller.set(r.seller_id, emptyByState());
    statesBySeller.get(r.seller_id)[r.payout_state] += Number(r.gross) - Number(r.commission);
  }

  const sellers = totalRows.map((r) => ({
    sellerId: r.seller_id,
    fullName: r.full_name,
    email: r.email,
    currentCommissionRate: Number(r.current_rate),
    orderCount: Number(r.order_count),
    units: Number(r.units),
    gross: Number(r.gross),
    commission: Number(r.commission),
    payout: Number(r.gross) - Number(r.commission),
    byState: statesBySeller.get(r.seller_id) || emptyByState(),
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
    byState: sellers.reduce((acc, s) => {
      for (const state of PAYOUT_STATES) acc[state] += s.byState[state];
      return acc;
    }, emptyByState()),
  };
}
