import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as payoutsService from '../services/payoutsService.js';

export const adminPayoutsRouter = Router();

adminPayoutsRouter.get('/', requireAuth, async (req, res) => {
  res.json(await payoutsService.listForAdmin({ sellerId: req.query.sellerId }));
});

// Lo que se le puede pagar hoy a un vendedor: ventas que ya cumplieron la
// retención y no están bloqueadas por una devolución.
adminPayoutsRouter.get('/disponible/:sellerId', requireAuth, async (req, res) => {
  res.json(await payoutsService.listAvailableForSeller(req.params.sellerId));
});

adminPayoutsRouter.post('/', requireAuth, async (req, res) => {
  const body = req.body || {};
  const payout = await payoutsService.create(
    body.sellerId,
    { orderItemIds: body.orderItemIds, note: body.note },
    req.admin.sub
  );
  res.status(201).json(payout);
});
