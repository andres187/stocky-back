import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// La web manda la sesión en la cookie httpOnly; la app móvil no puede (React
// Native no persiste cookies de forma confiable), así que manda el mismo JWT en
// `Authorization: Bearer`. La cookie tiene prioridad, así que el camino de la
// web no cambia en nada.
function readToken(req) {
  const fromCookie = req.cookies?.stocky_customer_token;
  if (fromCookie) return fromCookie;

  const header = req.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && value) return value.trim();

  return null;
}

export function requireCustomerAuth(req, res, next) {
  const token = readToken(req);

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
