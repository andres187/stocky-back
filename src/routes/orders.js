import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireCustomerAuth } from '../middleware/customerAuth.js';
import * as ordersService from '../services/ordersService.js';

export const ordersRouter = Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de pago. Espera unos minutos y vuelve a intentar.' },
});

ordersRouter.post('/checkout', requireCustomerAuth, checkoutLimiter, async (req, res) => {
  const body = req.body || {};
  const order = await ordersService.checkout(
    req.customer.sub,
    body.customer || {},
    body.lines,
    body.amountInCents,
    body.paymentMethod || {},
    body.idempotencyKey
  );
  res.status(201).json(order);
});

ordersRouter.get('/', requireCustomerAuth, async (req, res) => {
  res.json(await ordersService.listForCustomer(req.customer.sub));
});

ordersRouter.get('/:id', requireCustomerAuth, async (req, res) => {
  res.json(await ordersService.getForCustomer(req.customer.sub, req.params.id));
});
