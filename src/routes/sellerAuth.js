import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireSellerAuth } from '../middleware/sellerAuth.js';
import { config } from '../config.js';
import * as sellerAuthService from '../services/sellerAuthService.js';

export const sellerAuthRouter = Router();

const COOKIE_NAME = 'stocky_seller_token';
const COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // debe coincidir con SELLER_JWT_EXPIRES_IN

const authLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' },
});

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  };
}

// No setea cookie: la cuenta queda pendiente de aprobación, todavía no hay sesión.
sellerAuthRouter.post('/register', authLimiter(), async (req, res) => {
  const seller = await sellerAuthService.register(
    req.body?.email,
    req.body?.password,
    req.body?.fullName,
    req.body?.phone
  );
  res.status(201).json(seller);
});

sellerAuthRouter.post('/login', authLimiter(), async (req, res) => {
  const { token, email, fullName } = await sellerAuthService.login(req.body?.email, req.body?.password);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ email, fullName });
});

sellerAuthRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

sellerAuthRouter.get('/me', requireSellerAuth, async (req, res) => {
  res.json(await sellerAuthService.getById(req.seller.sub));
});
