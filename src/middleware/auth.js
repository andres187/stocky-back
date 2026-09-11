import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function requireAuth(req, res, next) {
  const token = req.cookies?.liva_admin_token;

  if (!token) {
    return res.status(401).json({ error: 'Falta el token de autenticación.' });
  }

  try {
    req.admin = jwt.verify(token, config.jwt.secret);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}
