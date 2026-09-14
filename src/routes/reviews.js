import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireCustomerAuth } from '../middleware/customerAuth.js';
import * as reviewsService from '../services/reviewsService.js';

export const reviewsRouter = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' },
});

reviewsRouter.get('/me', requireCustomerAuth, async (req, res) => {
  res.json(await reviewsService.listForCustomer(req.customer.sub));
});

reviewsRouter.post('/', requireCustomerAuth, writeLimiter, async (req, res) => {
  const review = await reviewsService.create(req.customer.sub, req.body || {});
  res.status(201).json(review);
});

reviewsRouter.patch('/:id', requireCustomerAuth, writeLimiter, async (req, res) => {
  res.json(await reviewsService.update(req.customer.sub, req.params.id, req.body || {}));
});

reviewsRouter.delete('/:id', requireCustomerAuth, async (req, res) => {
  await reviewsService.remove(req.customer.sub, req.params.id);
  res.status(204).end();
});
