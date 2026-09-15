import { Router } from 'express';
import { requireSellerAuth } from '../middleware/sellerAuth.js';
import * as productsService from '../services/productsService.js';
import * as sellerSalesService from '../services/sellerSalesService.js';
import * as reportsService from '../services/reportsService.js';
import * as payoutsService from '../services/payoutsService.js';

// Portal del dueño: todo va filtrado por req.seller.sub, nunca por un id del body.
export const sellerRouter = Router();

sellerRouter.use(requireSellerAuth);

sellerRouter.get('/products', async (req, res) => {
  res.json(await productsService.listForSeller(req.seller.sub));
});

sellerRouter.get('/products/:id', async (req, res) => {
  res.json(await productsService.getForSeller(req.seller.sub, req.params.id));
});

sellerRouter.post('/products', async (req, res) => {
  res.status(201).json(await productsService.createForSeller(req.seller.sub, req.body));
});

sellerRouter.put('/products/:id', async (req, res) => {
  res.json(await productsService.updateForSeller(req.seller.sub, req.params.id, req.body));
});

sellerRouter.delete('/products/:id', async (req, res) => {
  await productsService.removeForSeller(req.seller.sub, req.params.id);
  res.status(204).end();
});

sellerRouter.get('/sales', async (req, res) => {
  res.json(await sellerSalesService.listForSeller(req.seller.sub, { from: req.query.from, to: req.query.to }));
});

// Histórico de pagos recibidos, para que el dueño pueda cuadrar contra lo que
// el reporte de ventas le muestra como "ya pagado".
sellerRouter.get('/payouts', async (req, res) => {
  res.json(await payoutsService.listForSeller(req.seller.sub));
});

// Reportes del propio dueño: sellerId siempre sale de la sesión (req.seller.sub),
// nunca del query — un dueño no puede pedir los números de otro.
function range(req) {
  return { from: req.query.from, to: req.query.to };
}

sellerRouter.get('/reports/summary', async (req, res) => {
  res.json(await reportsService.summary(range(req), { sellerId: req.seller.sub }));
});

sellerRouter.get('/reports/timeseries', async (req, res) => {
  res.json(
    await reportsService.timeseries(range(req), { sellerId: req.seller.sub, groupBy: req.query.groupBy })
  );
});

sellerRouter.get('/reports/top-products', async (req, res) => {
  res.json(
    await reportsService.topProducts(range(req), { sellerId: req.seller.sub, limit: req.query.limit })
  );
});

sellerRouter.get('/reports/by-category', async (req, res) => {
  res.json(await reportsService.byCategory(range(req), { sellerId: req.seller.sub }));
});

sellerRouter.get('/reports/inventory', async (req, res) => {
  res.json(await reportsService.inventory(range(req), { sellerId: req.seller.sub }));
});
