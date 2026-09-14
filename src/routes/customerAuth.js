import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireCustomerAuth } from '../middleware/customerAuth.js';
import { config } from '../config.js';
import * as customerAuthService from '../services/customerAuthService.js';

export const customerAuthRouter = Router();

const COOKIE_NAME = 'stocky_customer_token';
const COOKIE_MAX_AGE_MS = 8 * 60 * 60 * 1000; // debe coincidir con CUSTOMER_JWT_EXPIRES_IN

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' },
});

// El OTP es más estricto que el login con contraseña: cada envío cuesta un SMS
// o un correo real, así que se limita a 5 por ventana en vez de 10.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados códigos solicitados. Espera unos minutos y vuelve a intentar.' },
});

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

customerAuthRouter.post('/register', registerLimiter, async (req, res) => {
  const { token, email, fullName } = await customerAuthService.register(
    req.body?.email,
    req.body?.password,
    req.body?.fullName,
    req.body?.phone
  );
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ email, fullName });
});

customerAuthRouter.post('/login', loginLimiter, async (req, res) => {
  const { token, email, fullName } = await customerAuthService.login(req.body?.email, req.body?.password);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ email, fullName });
});

// --------------------------------------------------- entrada con código OTP
// Camino para la app móvil: celular o correo, sin contraseña. Además de la
// cookie (que es lo que usa la web) estos endpoints devuelven el token en el
// cuerpo, porque React Native no maneja cookies de forma confiable. Es una
// excepción consciente a la regla "el token nunca va en el cuerpo", y solo aquí.

customerAuthRouter.post('/otp/request', otpLimiter, async (req, res) => {
  await customerAuthService.requestCode({
    channel: req.body?.channel,
    email: req.body?.email,
    regionCode: req.body?.regionCode,
    phone: req.body?.phone,
    isLogin: req.body?.isLogin === true,
  });
  res.status(204).end();
});

customerAuthRouter.post('/otp/login', loginLimiter, async (req, res) => {
  const { token, customer } = await customerAuthService.loginWithCode({
    channel: req.body?.channel,
    email: req.body?.email,
    regionCode: req.body?.regionCode,
    phone: req.body?.phone,
    code: req.body?.code,
  });
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ token, customer });
});

customerAuthRouter.post('/otp/register', registerLimiter, async (req, res) => {
  const { token, customer } = await customerAuthService.registerWithCode({
    channel: req.body?.channel,
    fullName: req.body?.fullName,
    lastName: req.body?.lastName,
    email: req.body?.email,
    regionCode: req.body?.regionCode,
    phone: req.body?.phone,
    code: req.body?.code,
  });
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ token, customer });
});

customerAuthRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
});

customerAuthRouter.get('/me', requireCustomerAuth, async (req, res) => {
  res.json(await customerAuthService.getById(req.customer.sub));
});
