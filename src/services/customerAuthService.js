import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const GENERIC_LOGIN_ERROR = 'Correo o contraseña incorrectos.';

function validateRegisterPayload({ email, password, fullName }) {
  const errors = [];
  if (!email || !EMAIL_RE.test(email)) errors.push('Ingresa un correo válido.');
  if (!password || password.length < 8) errors.push('La contraseña debe tener al menos 8 caracteres.');
  if (!fullName || !fullName.trim()) errors.push('El nombre completo es obligatorio.');
  if (errors.length > 0) throw new HttpError(400, { errors });
}

export async function register(email, password, fullName, phone) {
  validateRegisterPayload({ email, password, fullName });

  const passwordHash = await bcrypt.hash(password, 12);

  let insertId;
  try {
    const [result] = await pool.query(
      'INSERT INTO customers (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)',
      [email, passwordHash, fullName, phone || null]
    );
    insertId = result.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Ese correo ya está registrado.');
    }
    throw err;
  }

  const token = jwt.sign(
    { sub: insertId, email },
    config.customerJwt.secret,
    { expiresIn: config.customerJwt.expiresIn }
  );

  return { token, id: insertId, email, fullName };
}

export async function login(email, password) {
  if (!email || !password) {
    throw new HttpError(400, 'Correo y contraseña son obligatorios.');
  }

  const [rows] = await pool.query('SELECT * FROM customers WHERE email = ?', [email]);
  const customer = rows[0];
  if (!customer) {
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }

  const valid = await bcrypt.compare(password, customer.password_hash);
  if (!valid) {
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }

  const token = jwt.sign(
    { sub: customer.id, email: customer.email },
    config.customerJwt.secret,
    { expiresIn: config.customerJwt.expiresIn }
  );

  return { token, id: customer.id, email: customer.email, fullName: customer.full_name };
}

export async function getById(id) {
  const [rows] = await pool.query('SELECT id, email, full_name, phone FROM customers WHERE id = ?', [id]);
  const customer = rows[0];
  if (!customer) throw new HttpError(404, 'Cliente no encontrado.');
  return { id: customer.id, email: customer.email, fullName: customer.full_name, phone: customer.phone };
}
