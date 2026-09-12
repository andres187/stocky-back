import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function requireCustomerAuth(req, res, next) {
  const token = req.cookies?.stocky_customer_token;

  if (!token) {
    return res.status(401).json({ error: 'Falta el token de autenticación.' });
  }

  try {
    req.customer = jwt.verify(token, config.customerJwt.secret);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}
