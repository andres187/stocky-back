import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { HttpError } from './services/errors.js';
import { authRouter } from './routes/auth.js';
import { customerAuthRouter } from './routes/customerAuth.js';
import { sellerAuthRouter } from './routes/sellerAuth.js';
import { sellerRouter } from './routes/sellerProducts.js';
import { sellersRouter } from './routes/sellers.js';
import { adminSellerSalesRouter } from './routes/adminSellerSales.js';
import { adminReportsRouter } from './routes/adminReports.js';
import { productsRouter } from './routes/products.js';
import { categoriesRouter } from './routes/categories.js';
import { colorsRouter } from './routes/colors.js';
import { sizesRouter } from './routes/sizes.js';
import { ordersRouter } from './routes/orders.js';
import { adminShipmentsRouter } from './routes/adminShipments.js';
import { sellerShipmentsRouter } from './routes/sellerShipments.js';
import { returnsRouter } from './routes/returns.js';
import { adminReturnsRouter } from './routes/adminReturns.js';
import { adminPayoutsRouter } from './routes/adminPayouts.js';
import { wompiWebhookRouter } from './routes/wompiWebhook.js';
import { reviewsRouter } from './routes/reviews.js';
import { paymentsRouter } from './routes/payments.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/customer-auth', customerAuthRouter);
app.use('/api/seller-auth', sellerAuthRouter);
app.use('/api/seller/shipments', sellerShipmentsRouter);
app.use('/api/seller', sellerRouter);
app.use('/api/sellers', sellersRouter);
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/colors', colorsRouter);
app.use('/api/sizes', sizesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin/shipments', adminShipmentsRouter);
app.use('/api/admin/seller-sales', adminSellerSalesRouter);
app.use('/api/admin/returns', adminReturnsRouter);
app.use('/api/admin/seller-payouts', adminPayoutsRouter);
app.use('/api/admin/reports', adminReportsRouter);
app.use('/api/webhooks/wompi', wompiWebhookRouter);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Error "conocido" lanzado por un service (validación, no encontrado, conflicto):
  // su status/body ya están pensados para el cliente, se devuelven tal cual.
  if (err instanceof HttpError) {
    return res.status(err.status).json(err.body);
  }

  const errorId = Math.random().toString(36).slice(2, 8);
  // Detalle completo (mensaje, stack, request) solo va al log del servidor — nunca a la respuesta HTTP.
  console.error(JSON.stringify({
    level: 'error',
    errorId,
    time: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    stack: err.stack,
  }));
  // El cliente recibe un mensaje genérico y un código corto para poder reportar el problema
  // sin que la respuesta filtre detalles internos (consulta SQL, ruta de archivos, etc).
  res.status(500).json({ error: `Ocurrió un error inesperado. Código: ${errorId}` });
});

const server = app.listen(config.port, () => {
  console.log(`API de Stocky escuchando en http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} recibido, cerrando servidor...`);
  server.close(async () => {
    await pool.end();
    console.log('Servidor y pool de conexiones cerrados.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function logFatal(kind, err) {
  console.error(JSON.stringify({
    level: 'fatal',
    kind,
    time: new Date().toISOString(),
    message: err?.message,
    stack: err?.stack,
  }));
}

process.on('unhandledRejection', (err) => {
  logFatal('unhandledRejection', err);
});

process.on('uncaughtException', (err) => {
  logFatal('uncaughtException', err);
  process.exit(1);
});
