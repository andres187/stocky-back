import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as paymentService from '../services/paymentService.js';

export const paymentsRouter = Router();

const banksLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera un momento y vuelve a intentar.' },
});

// GET /api/payments/pse/banks — público, alimenta el selector de banco del checkout.
paymentsRouter.get('/pse/banks', banksLimiter, async (req, res) => {
  res.json(await paymentService.listPseBanks());
});
