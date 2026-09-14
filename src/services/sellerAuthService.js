import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const GENERIC_LOGIN_ERROR = 'Correo o contraseña incorrectos.';
const NOT_APPROVED_ERROR = 'Tu cuenta todavía no ha sido aprobada. Te avisaremos cuando lo esté.';
const REJECTED_ERROR = 'Tu solicitud de cuenta fue rechazada. Escríbenos si crees que es un error.';

function validateRegisterPayload({ email, password, fullName }) {
  const errors = [];
  if (!email || !EMAIL_RE.test(email)) errors.push('Ingresa un correo válido.');
  if (!password || password.length < 8) errors.push('La contraseña debe tener al menos 8 caracteres.');
  if (!fullName || !fullName.trim()) errors.push('El nombre completo es obligatorio.');
  if (errors.length > 0) throw new HttpError(400, { errors });
}

function statusError(status) {
  if (status === 'rejected') return new HttpError(403, REJECTED_ERROR);
  return new HttpError(403, NOT_APPROVED_ERROR);
}

// El registro NO devuelve token: la cuenta nace 'pending' y no puede entrar al portal
// hasta que un admin la apruebe (no hay sesión que dar todavía).
export async function register(email, password, fullName, phone) {
  validateRegisterPayload({ email, password, fullName });

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const [result] = await pool.query(
      'INSERT INTO sellers (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)',
      [email, passwordHash, fullName.trim(), phone || null]
    );
    return { id: result.insertId, email, fullName: fullName.trim(), status: 'pending' };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Ese correo ya está registrado como dueño.');
    }
    throw err;
  }
}

export async function login(email, password) {
  if (!email || !password) {
    throw new HttpError(400, 'Correo y contraseña son obligatorios.');
  }

  const [rows] = await pool.query('SELECT * FROM sellers WHERE email = ?', [email]);
  const seller = rows[0];
  if (!seller) {
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }

  const valid = await bcrypt.compare(password, seller.password_hash);
  if (!valid) {
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }

  // El estado se revisa DESPUÉS de validar la contraseña: al revés, el mensaje
  // "tu cuenta no está aprobada" le confirmaría a cualquiera que ese correo existe.
  if (seller.status !== 'approved') {
    throw statusError(seller.status);
  }

  const token = jwt.sign(
    { sub: seller.id, email: seller.email },
    config.sellerJwt.secret,
    { expiresIn: config.sellerJwt.expiresIn }
  );

  return { token, id: seller.id, email: seller.email, fullName: seller.full_name };
}

export async function getById(id) {
  const [rows] = await pool.query(
    'SELECT id, email, full_name, phone, commission_rate, status FROM sellers WHERE id = ?',
    [id]
  );
  const seller = rows[0];
  if (!seller) throw new HttpError(404, 'Dueño no encontrado.');
  return {
    id: seller.id,
    email: seller.email,
    fullName: seller.full_name,
    phone: seller.phone,
    commissionRate: Number(seller.commission_rate),
    status: seller.status,
  };
}
