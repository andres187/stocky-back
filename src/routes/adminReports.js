import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as reportsService from '../services/reportsService.js';

export const adminReportsRouter = Router();

adminReportsRouter.use(requireAuth);

// Todas las rutas admiten un `sellerId` opcional en el query para filtrar el
// reporte a un solo dueño (por ejemplo, revisar sus números antes de aprobar
// una liquidación). Sin `sellerId`, el reporte es de toda la tienda.
function range(req) {
  return { from: req.query.from, to: req.query.to };
}

function optionalSellerId(req) {
  return req.query.sellerId != null && req.query.sellerId !== '' ? Number(req.query.sellerId) : undefined;
}

adminReportsRouter.get('/summary', async (req, res) => {
  res.json(await reportsService.summary(range(req), { sellerId: optionalSellerId(req) }));
});

adminReportsRouter.get('/timeseries', async (req, res) => {
  res.json(
    await reportsService.timeseries(range(req), {
      sellerId: optionalSellerId(req),
      groupBy: req.query.groupBy,
    })
  );
});

adminReportsRouter.get('/top-products', async (req, res) => {
  res.json(
    await reportsService.topProducts(range(req), { sellerId: optionalSellerId(req), limit: req.query.limit })
  );
});

adminReportsRouter.get('/by-category', async (req, res) => {
  res.json(await reportsService.byCategory(range(req), { sellerId: optionalSellerId(req) }));
});

adminReportsRouter.get('/inventory', async (req, res) => {
  res.json(await reportsService.inventory(range(req), { sellerId: optionalSellerId(req) }));
});
