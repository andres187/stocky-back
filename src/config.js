import 'dotenv/config';

const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];

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
};
