import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import * as authService from '../services/authService.js';

export const authRouter = Router();

const COOKIE_NAME = 'liva_admin_token';
const COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // debe coincidir con JWT_EXPIRES_IN

const loginLimiter = rateLimit({
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

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { token, username } = await authService.login(req.body?.username, req.body?.password);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ username });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.admin.username });
});
