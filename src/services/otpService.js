import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import * as emailService from './emailService.js';

// Código de un solo uso (OTP) para entrar o registrarse con celular o correo,
// siguiendo el patrón de etniapp-core (UserAppAuthService):
//   - SMS   → Twilio Verify guarda y valida el código; aquí no se persiste nada.
//   - Correo → el código se genera y valida aquí, y se envía con Resend.
// Dos diferencias deliberadas con la referencia: el código se genera con
// `crypto.randomInt` (etniapp usa `Random.Shared`, no criptográfico) y cada OTP
// de correo lleva un contador de intentos (etniapp no tiene ninguno).

const TWILIO_BASE_URL = 'https://verify.twilio.com/v2';
const GENERIC_CODE_ERROR = 'El código es incorrecto o ya venció.';

export function normalizePhone(regionCode, phone) {
  const region = String(regionCode || '').trim();
  const number = String(phone || '').replace(/[\s()-]/g, '');
  if (!/^\+\d{1,4}$/.test(region)) {
    throw new HttpError(400, { errors: ['El prefijo de país debe tener la forma +57.'] });
  }
  if (!/^\d{7,15}$/.test(number)) {
    throw new HttpError(400, { errors: ['Ingresa un número de celular válido.'] });
  }
  return { regionCode: region, phone: number, e164: `${region}${number}` };
}

// ---------------------------------------------------------------- correo

export async function sendEmailCode(email) {
  // Un correo solo puede tener un código vivo a la vez: pedir uno nuevo invalida
  // el anterior, para que un código viejo interceptado deje de servir.
  await pool.query('UPDATE customer_email_otps SET used = 1 WHERE email = ? AND used = 0', [email]);

  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + config.otp.expiresMinutes * 60 * 1000);

  await pool.query(
    'INSERT INTO customer_email_otps (email, code, expires_at) VALUES (?, ?, ?)',
    [email, code, expiresAt]
  );

  // A diferencia del correo de confirmación de pedido, este NO es best-effort:
  // si el envío falla el usuario se queda esperando un código que nunca llega,
  // así que el error tiene que llegarle al cliente.
  await emailService.sendOtpCode({ to: email, code, expiresMinutes: config.otp.expiresMinutes });
}

export async function verifyEmailCode(email, code) {
  if (!code || !/^\d{6}$/.test(String(code).trim())) {
    throw new HttpError(400, GENERIC_CODE_ERROR);
  }

  const [rows] = await pool.query(
    'SELECT * FROM customer_email_otps WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1',
    [email]
  );
  const otp = rows[0];
  if (!otp || new Date(otp.expires_at) < new Date()) {
    throw new HttpError(400, GENERIC_CODE_ERROR);
  }

  if (otp.attempts >= config.otp.maxAttempts) {
    await pool.query('UPDATE customer_email_otps SET used = 1 WHERE id = ?', [otp.id]);
    throw new HttpError(429, 'Demasiados intentos con ese código. Pide uno nuevo.');
  }

  if (otp.code !== String(code).trim()) {
    await pool.query('UPDATE customer_email_otps SET attempts = attempts + 1 WHERE id = ?', [otp.id]);
    throw new HttpError(400, GENERIC_CODE_ERROR);
  }

  // Un código válido se quema de inmediato: sirve una sola vez.
  await pool.query('UPDATE customer_email_otps SET used = 1 WHERE id = ?', [otp.id]);
}

// ------------------------------------------------------------------- SMS

function twilioAuthHeader() {
  const { accountSid, authToken, verifyServiceSid } = config.twilio;
  if (!accountSid || !authToken || !verifyServiceSid) {
    throw new HttpError(503, 'El envío de códigos por SMS no está configurado en este servidor.');
  }
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

async function twilioPost(path, params) {
  const authorization = twilioAuthHeader();
  const res = await fetch(`${TWILIO_BASE_URL}/Services/${config.twilio.verifyServiceSid}${path}`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  let body;
  try {
    body = await res.json();
  } catch {
    throw new HttpError(502, 'El proveedor de SMS respondió algo que no se pudo leer.');
  }

  return { ok: res.ok, status: res.status, body };
}

export async function sendSmsCode(regionCode, phone) {
  const { e164 } = normalizePhone(regionCode, phone);
  const { ok, body } = await twilioPost('/Verifications', { To: e164, Channel: 'sms' });

  if (!ok) {
    // 60200 (número inválido) y 60203 (demasiados envíos al mismo número) son
    // culpa de quien pide, no del servidor, así que se devuelven como 4xx.
    if (body?.code === 60200) throw new HttpError(400, 'Ingresa un número de celular válido.');
    if (body?.code === 60203) throw new HttpError(429, 'Ya pediste varios códigos a ese número. Espera unos minutos.');
    console.error(JSON.stringify({ level: 'error', scope: 'otp-sms', message: body?.message, code: body?.code }));
    throw new HttpError(502, 'No se pudo enviar el código por SMS. Intenta de nuevo.');
  }

  return body.status; // 'pending'
}

export async function verifySmsCode(regionCode, phone, code) {
  const { e164 } = normalizePhone(regionCode, phone);
  if (!code || !/^\d{4,10}$/.test(String(code).trim())) {
    throw new HttpError(400, GENERIC_CODE_ERROR);
  }

  const { ok, body } = await twilioPost('/VerificationCheck', { To: e164, Code: String(code).trim() });

  // Twilio responde 404 cuando ya no hay una verificación viva para ese número
  // (código vencido o ya usado): para el cliente es el mismo caso que un código
  // equivocado, y decirlo así evita revelar si alguien pidió un código o no.
  if (!ok) {
    if (body?.code === 20404) throw new HttpError(400, GENERIC_CODE_ERROR);
    console.error(JSON.stringify({ level: 'error', scope: 'otp-sms', message: body?.message, code: body?.code }));
    throw new HttpError(502, 'No se pudo validar el código. Intenta de nuevo.');
  }

  if (body.status === 'max_attempts_reached') {
    throw new HttpError(429, 'Demasiados intentos con ese código. Pide uno nuevo.');
  }
  if (body.status !== 'approved') {
    throw new HttpError(400, GENERIC_CODE_ERROR);
  }
}
