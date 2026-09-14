import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import * as otpService from './otpService.js';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const GENERIC_LOGIN_ERROR = 'Correo o contraseña incorrectos.';

function issueToken({ id, email }) {
  return jwt.sign({ sub: id, email }, config.customerJwt.secret, { expiresIn: config.customerJwt.expiresIn });
}

function serialize(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    lastName: row.last_name ?? null,
    regionCode: row.region_code ?? null,
    phone: row.phone ?? null,
  };
}

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

  const token = issueToken({ id: insertId, email });

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

  // Una cuenta creada con código OTP no tiene password_hash: por este camino no
  // puede entrar, y el error es el mismo genérico para no delatar qué cuentas existen.
  if (!customer.password_hash) {
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }

  const valid = await bcrypt.compare(password, customer.password_hash);
  if (!valid) {
    throw new HttpError(401, GENERIC_LOGIN_ERROR);
  }

  const token = issueToken({ id: customer.id, email: customer.email });

  return { token, id: customer.id, email: customer.email, fullName: customer.full_name };
}

export async function getById(id) {
  const [rows] = await pool.query(
    'SELECT id, email, full_name, last_name, region_code, phone FROM customers WHERE id = ?',
    [id]
  );
  const customer = rows[0];
  if (!customer) throw new HttpError(404, 'Cliente no encontrado.');
  return serialize(customer);
}


// ------------------------------------------------------- entrada con código OTP
// Camino paralelo al de correo+contraseña de arriba, para la app móvil: se entra
// con celular o con correo, sin contraseña, igual que etniapp-core.

const CHANNELS = ['sms', 'email'];

function validateChannel(channel) {
  if (!CHANNELS.includes(channel)) {
    throw new HttpError(400, 'Canal inválido: usa "sms" o "email".');
  }
}

function validateEmail(email) {
  if (!email || !EMAIL_RE.test(email)) {
    throw new HttpError(400, { errors: ['Ingresa un correo válido.'] });
  }
  return email.trim().toLowerCase();
}

async function findByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM customers WHERE email = ?', [email]);
  return rows[0] || null;
}

async function findByPhone(regionCode, phone) {
  const [rows] = await pool.query(
    'SELECT * FROM customers WHERE region_code = ? AND phone = ?',
    [regionCode, phone]
  );
  return rows[0] || null;
}

// Envía el código. `isLogin` decide qué se exige de la cuenta, igual que en la
// referencia: para entrar tiene que existir, para registrarse tiene que no existir.
export async function requestCode({ channel, email, regionCode, phone, isLogin }) {
  validateChannel(channel);

  if (channel === 'email') {
    const normalized = validateEmail(email);
    const existing = await findByEmail(normalized);
    if (isLogin && !existing) throw new HttpError(404, 'No encontramos una cuenta con ese correo.');
    if (!isLogin && existing) throw new HttpError(409, 'Ese correo ya está registrado.');
    await otpService.sendEmailCode(normalized);
    return;
  }

  const normalized = otpService.normalizePhone(regionCode, phone);
  const existing = await findByPhone(normalized.regionCode, normalized.phone);
  if (isLogin && !existing) throw new HttpError(404, 'No encontramos una cuenta con ese celular.');
  if (!isLogin && existing) throw new HttpError(409, 'Ese celular ya está registrado.');
  await otpService.sendSmsCode(normalized.regionCode, normalized.phone);
}

export async function loginWithCode({ channel, email, regionCode, phone, code }) {
  validateChannel(channel);

  let customer;
  if (channel === 'email') {
    const normalized = validateEmail(email);
    await otpService.verifyEmailCode(normalized, code);
    customer = await findByEmail(normalized);
  } else {
    const normalized = otpService.normalizePhone(regionCode, phone);
    await otpService.verifySmsCode(normalized.regionCode, normalized.phone, code);
    customer = await findByPhone(normalized.regionCode, normalized.phone);
  }

  // El código ya se quemó al validarlo, así que si la cuenta desapareció entre
  // el envío y la verificación no hay nada que hacer más que pedir registrarse.
  if (!customer) {
    throw new HttpError(404, 'No encontramos una cuenta con esos datos.');
  }

  return { token: issueToken(customer), customer: serialize(customer) };
}

export async function registerWithCode({ channel, fullName, lastName, email, regionCode, phone, code }) {
  validateChannel(channel);

  const errors = [];
  if (!fullName || !fullName.trim()) errors.push('El nombre es obligatorio.');
  if (!lastName || !lastName.trim()) errors.push('El apellido es obligatorio.');
  if (errors.length > 0) throw new HttpError(400, { errors });

  const normalizedEmail = validateEmail(email);
  const normalizedPhone = otpService.normalizePhone(regionCode, phone);

  // Se comprueba antes de quemar el código: si el correo o el celular ya están
  // tomados, el usuario recibe el conflicto con su código todavía vivo.
  if (await findByEmail(normalizedEmail)) throw new HttpError(409, 'Ese correo ya está registrado.');
  if (await findByPhone(normalizedPhone.regionCode, normalizedPhone.phone)) {
    throw new HttpError(409, 'Ese celular ya está registrado.');
  }

  // El registro verifica el código él mismo en vez de confiar en que el cliente
  // ya pasó por un endpoint de verificación aparte (como sí hace etniapp-core):
  // así no existe forma de crear una cuenta sin haber probado el celular/correo.
  if (channel === 'email') {
    await otpService.verifyEmailCode(normalizedEmail, code);
  } else {
    await otpService.verifySmsCode(normalizedPhone.regionCode, normalizedPhone.phone, code);
  }

  let insertId;
  try {
    const [result] = await pool.query(
      'INSERT INTO customers (email, password_hash, full_name, last_name, region_code, phone) VALUES (?, NULL, ?, ?, ?, ?)',
      [normalizedEmail, fullName.trim(), lastName.trim(), normalizedPhone.regionCode, normalizedPhone.phone]
    );
    insertId = result.insertId;
  } catch (err) {
    // Carrera entre la comprobación de arriba y el INSERT: los índices únicos
    // (email, y region_code+phone) son la garantía real.
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Ese correo o ese celular ya están registrados.');
    }
    throw err;
  }

  const customer = {
    id: insertId,
    email: normalizedEmail,
    full_name: fullName.trim(),
    last_name: lastName.trim(),
    region_code: normalizedPhone.regionCode,
    phone: normalizedPhone.phone,
  };

  return { token: issueToken(customer), customer: serialize(customer) };
}
