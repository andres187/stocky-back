import { pool } from '../db/pool.js';
import { HttpError } from './errors.js';

// Solo cuentan las órdenes pagadas: una declinada existe como fila (ver ordersService)
// pero no se le debe plata a nadie por ella. Compartido con sellerSalesService.js.
export const PAID_ONLY = "o.status = 'paid'";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Devuelve [sqlExtra, params] para un rango opcional de fechas sobre orders.created_at.
// `to` es inclusivo: se compara contra el día siguiente.
export function dateRange({ from, to } = {}) {
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
export const GROSS = 'oi.quantity * oi.unit_price';
export const COMMISSION = `ROUND(${GROSS} * COALESCE(oi.commission_rate, 0) / 100)`;

// Cantidad mínima de unidades en una variante para dejar de considerarla "stock bajo".
export const LOW_STOCK_THRESHOLD = 3;

// Días que se retiene el pago al vendedor después de que el comprador confirma
// que recibió el pedido. Es la ventana en la que puede pedir una devolución.
export const RECEIPT_HOLD_DAYS = 15;

// Si el comprador nunca confirma, se da por recibido a los N días de "entregado"
// (ver src/scripts/autoConfirmDeliveries.js). Sin esto la plata del vendedor
// quedaría congelada para siempre por un cliente que simplemente no vuelve.
export const AUTO_CONFIRM_DAYS = 7;

// Estado de pago de una venta. Es derivado, no una columna: el paso del tiempo
// solo ya mueve una venta de "retenida" a "disponible", sin que ningún job
// tenga que ir marcando filas. Quien lo use debe tener en el FROM los alias
// `sh` (shipments), `rr` (return_requests) y `spi` (seller_payout_items).
//
// Orden de los casos, de más fuerte a más débil: ya pagado gana sobre todo lo
// demás; un envío cancelado/devuelto o una devolución aprobada bloquean; una
// devolución abierta retiene aunque ya hayan pasado los 15 días.
export const PAYOUT_STATE_SQL = `
  CASE
    WHEN spi.id IS NOT NULL THEN 'paid'
    WHEN sh.status IN ('cancelled','returned') THEN 'blocked'
    WHEN rr.status = 'approved' THEN 'blocked'
    WHEN rr.status = 'pending' THEN 'on_hold'
    WHEN sh.received_at IS NULL THEN 'pending'
    WHEN sh.received_at > DATE_SUB(NOW(), INTERVAL ${RECEIPT_HOLD_DAYS} DAY) THEN 'on_hold'
    ELSE 'available'
  END`;

// JOINs que PAYOUT_STATE_SQL necesita. Se exportan juntos para que no se pueda
// usar la expresión sin ellos (daría un error de SQL, pero mejor no llegar ahí).
export const PAYOUT_STATE_JOINS = `
  LEFT JOIN shipments sh ON sh.order_id = o.id
  LEFT JOIN return_requests rr ON rr.order_id = o.id
  LEFT JOIN seller_payout_items spi ON spi.order_item_id = oi.id`;

function sellerFilter(sellerId) {
  if (sellerId == null) return ['', []];
  return [' AND oi.seller_id = ?', [sellerId]];
}

// Tarjetas KPI: bruto, comisión, a pagar, unidades, pedidos y ticket promedio.
// sellerId presente = "mis ventas" (vendedor); ausente = toda la tienda (admin).
export async function summary(range, { sellerId } = {}) {
  const [rangeExtra, rangeParams] = dateRange(range);
  const [sellerExtra, sellerParams] = sellerFilter(sellerId);
  const [[row]] = await pool.query(
    `SELECT COUNT(DISTINCT o.id) AS order_count,
            COALESCE(SUM(oi.quantity), 0) AS units,
            COALESCE(SUM(${GROSS}), 0) AS gross,
            COALESCE(SUM(${COMMISSION}), 0) AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_ONLY}${rangeExtra}${sellerExtra}`,
    [...rangeParams, ...sellerParams]
  );

  const orderCount = Number(row.order_count);
  const gross = Number(row.gross);
  const commission = Number(row.commission);
  return {
    orderCount,
    units: Number(row.units),
    gross,
    commission,
    payout: gross - commission,
    avgTicket: orderCount > 0 ? Math.round(gross / orderCount) : 0,
  };
}

const GROUP_BY = {
  day: 'DATE(o.created_at)',
  month: "DATE_FORMAT(o.created_at, '%Y-%m')",
};

// Serie de ventas en el tiempo, agrupada por día o por mes.
export async function timeseries(range, { sellerId, groupBy = 'day' } = {}) {
  const bucket = GROUP_BY[groupBy];
  if (!bucket) throw new HttpError(400, 'El agrupamiento debe ser "day" o "month".');
  const [rangeExtra, rangeParams] = dateRange(range);
  const [sellerExtra, sellerParams] = sellerFilter(sellerId);
  const [rows] = await pool.query(
    `SELECT ${bucket} AS period,
            COUNT(DISTINCT o.id) AS order_count,
            SUM(oi.quantity) AS units,
            SUM(${GROSS}) AS gross,
            SUM(${COMMISSION}) AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_ONLY}${rangeExtra}${sellerExtra}
     GROUP BY period
     ORDER BY period ASC`,
    [...rangeParams, ...sellerParams]
  );

  return rows.map((r) => {
    const gross = Number(r.gross);
    const commission = Number(r.commission);
    return {
      period: String(r.period),
      orderCount: Number(r.order_count),
      units: Number(r.units),
      gross,
      commission,
      payout: gross - commission,
    };
  });
}

function clampLimit(limit, max = 50, fallback = 10) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), max);
}

// Ranking de productos más vendidos (por bruto) en el rango.
export async function topProducts(range, { sellerId, limit } = {}) {
  const [rangeExtra, rangeParams] = dateRange(range);
  const [sellerExtra, sellerParams] = sellerFilter(sellerId);
  const lim = clampLimit(limit);
  const [rows] = await pool.query(
    `SELECT oi.product_id, oi.product_name,
            SUM(oi.quantity) AS units,
            SUM(${GROSS}) AS gross,
            SUM(${COMMISSION}) AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_ONLY}${rangeExtra}${sellerExtra}
     GROUP BY oi.product_id, oi.product_name
     ORDER BY gross DESC
     LIMIT ?`,
    [...rangeParams, ...sellerParams, lim]
  );

  return rows.map((r) => {
    const gross = Number(r.gross);
    const commission = Number(r.commission);
    return {
      productId: r.product_id,
      productName: r.product_name,
      units: Number(r.units),
      gross,
      commission,
      payout: gross - commission,
    };
  });
}

// Ventas agrupadas por categoría del producto (la categoría actual en `products`,
// no un snapshot — igual que el resto de la vitrina).
export async function byCategory(range, { sellerId } = {}) {
  const [rangeExtra, rangeParams] = dateRange(range);
  const [sellerExtra, sellerParams] = sellerFilter(sellerId);
  const [rows] = await pool.query(
    `SELECT p.category,
            SUM(oi.quantity) AS units,
            SUM(${GROSS}) AS gross,
            SUM(${COMMISSION}) AS commission
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE ${PAID_ONLY}${rangeExtra}${sellerExtra}
     GROUP BY p.category
     ORDER BY gross DESC`,
    [...rangeParams, ...sellerParams]
  );

  return rows.map((r) => {
    const gross = Number(r.gross);
    const commission = Number(r.commission);
    return {
      category: r.category,
      units: Number(r.units),
      gross,
      commission,
      payout: gross - commission,
    };
  });
}

function parseVariantStock(raw) {
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// Vista de inventario: stock total por producto, si está agotado, y qué variantes
// están en stock bajo — para ver qué se vende y no se repone. `range` sólo afecta
// `unitsSold` (unidades vendidas en el período); el stock en sí es el actual.
export async function inventory(range, { sellerId } = {}) {
  const [rangeExtra, rangeParams] = dateRange(range);

  const productParams = [];
  let productFilter = '';
  if (sellerId != null) {
    productFilter = ' AND p.seller_id = ?';
    productParams.push(sellerId);
  }
  const [products] = await pool.query(
    `SELECT p.id, p.name, p.category, p.seller_id, s.full_name AS seller_name, p.variant_stock
     FROM products p
     LEFT JOIN sellers s ON s.id = p.seller_id
     WHERE p.active = 1${productFilter}`,
    productParams
  );

  const [sellerExtra, sellerParams] = sellerFilter(sellerId);
  const [soldRows] = await pool.query(
    `SELECT oi.product_id, SUM(oi.quantity) AS units
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_ONLY}${rangeExtra}${sellerExtra}
     GROUP BY oi.product_id`,
    [...rangeParams, ...sellerParams]
  );
  const soldByProduct = new Map(soldRows.map((r) => [r.product_id, Number(r.units)]));

  return products.map((p) => {
    const variants = parseVariantStock(p.variant_stock);
    const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
    const lowVariants = variants.filter((v) => (Number(v.stock) || 0) <= LOW_STOCK_THRESHOLD);
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      sellerId: p.seller_id ?? null,
      sellerName: p.seller_name ?? null,
      totalStock,
      outOfStock: totalStock === 0,
      lowVariants,
      unitsSold: soldByProduct.get(p.id) ?? 0,
    };
  });
}
