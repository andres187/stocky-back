import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireCustomerAuth } from '../middleware/customerAuth.js';
import * as returnsService from '../services/returnsService.js';

export const returnsRouter = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera unos minutos y vuelve a intentar.' },
});

returnsRouter.get('/me', requireCustomerAuth, async (req, res) => {
  res.json(await returnsService.listForCustomer(req.customer.sub));
});

returnsRouter.post('/', requireCustomerAuth, writeLimiter, async (req, res) => {
  const body = req.body || {};
  const created = await returnsService.createForCustomer(req.customer.sub, body.orderId, {
    reason: body.reason,
    body: body.body,
  });
  res.status(201).json(created);
});

returnsRouter.post('/:id/cancelar', requireCustomerAuth, writeLimiter, async (req, res) => {
  res.json(await returnsService.cancelForCustomer(req.customer.sub, req.params.id));
});
