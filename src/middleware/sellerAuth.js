import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

export async function requireSellerAuth(req, res, next) {
  const token = req.cookies?.stocky_seller_token;

  if (!token) {
    return res.status(401).json({ error: 'Falta el token de autenticación.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.sellerJwt.secret);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }

  // El estado se re-lee en cada request: si el admin revoca la aprobación, un token
  // emitido antes no debe seguir funcionando hasta que expire.
  const [rows] = await pool.query('SELECT id, email, status FROM sellers WHERE id = ?', [payload.sub]);
  const seller = rows[0];
  if (!seller) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
  if (seller.status !== 'approved') {
    return res.status(403).json({ error: 'Tu cuenta no está aprobada.' });
  }

  req.seller = { sub: seller.id, email: seller.email };
  next();
}
