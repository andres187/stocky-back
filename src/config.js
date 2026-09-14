import 'dotenv/config';

const REQUIRED = [
  'DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET',
  'CUSTOMER_JWT_SECRET',
  'SELLER_JWT_SECRET',
  'WOMPI_BASE_URL', 'WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_INTEGRITY_KEY', 'WOMPI_EVENTS_KEY',
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Faltan variables de entorno obligatorias en .env: ${missing.join(', ')}. ` +
    'Copia .env.example a .env y complétalas antes de arrancar.'
  );
  process.exit(1);
}

if (!process.env.CORS_ORIGIN) {
  console.warn(
    'CORS_ORIGIN no está definido en .env — usando http://localhost:5173 por defecto. ' +
    'Configúralo explícitamente en producción.'
  );
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  admin: {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  },
  customerJwt: {
    secret: process.env.CUSTOMER_JWT_SECRET,
    expiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || '8h',
  },
  sellerJwt: {
    secret: process.env.SELLER_JWT_SECRET,
    expiresIn: process.env.SELLER_JWT_EXPIRES_IN || '8h',
  },
  wompi: {
    baseUrl: process.env.WOMPI_BASE_URL,
    publicKey: process.env.WOMPI_PUBLIC_KEY,
    privateKey: process.env.WOMPI_PRIVATE_KEY,
    integrityKey: process.env.WOMPI_INTEGRITY_KEY,
    eventsKey: process.env.WOMPI_EVENTS_KEY,
  },
  // Twilio Verify (código OTP por SMS). Igual que Resend, a propósito fuera de
  // REQUIRED: el servidor arranca sin estas variables y solo el camino de SMS
  // responde 503 (ver otpService.js) en vez de tumbar toda la API.
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
  },
  otp: {
    expiresMinutes: Number(process.env.OTP_EXPIRES_MINUTES || 10),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  },
  // Resend es best-effort (ver emailService.js): a propósito no está en REQUIRED,
  // el checkout debe funcionar aunque el correo de confirmación no esté configurado.
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || '',
  },
  // Ventana de rotación de la vitrina (ver rotationService.js). Default 1 hora;
  // se puede bajar en desarrollo (p. ej. ROTATION_WINDOW_MS=5000) para probar el
  // cambio de orden sin esperar una hora real.
  rotation: {
    windowMs: Number(process.env.ROTATION_WINDOW_MS || 60 * 60 * 1000),
  },
};
