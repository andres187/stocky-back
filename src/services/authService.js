import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export async function login(username, password) {
  if (!username || !password) {
    throw new HttpError(400, 'Usuario y contraseña son obligatorios.');
  }

  const [rows] = await pool.query('SELECT * FROM admins WHERE username = ?', [username]);
  const admin = rows[0];
  if (!admin) {
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }

  const token = jwt.sign(
    { sub: admin.id, username: admin.username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  return { token, username: admin.username };
}
