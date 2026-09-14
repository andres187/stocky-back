import mysql from 'mysql2/promise';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function connect() {
  const dbName = config.db.name;
  try {
    return await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: dbName,
    });
  } catch (err) {
    if (err.code !== 'ER_BAD_DB_ERROR') throw err;
    // La base de datos no existe todavía y el usuario tiene permisos para crearla.
    const rootConn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
    });
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await rootConn.end();
    return mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: dbName,
    });
  }
}

async function main() {
  const conn = await connect();

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  const [rows] = await conn.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort();

  const pending = files.filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log('No hay migraciones pendientes.');
  }

  for (const name of pending) {
    console.log(`Aplicando ${name}...`);
    let mod;
    try {
      mod = await import(pathToFileURL(join(MIGRATIONS_DIR, name)).href);
      await mod.up(conn);
    } catch (err) {
      console.error(`Error aplicando la migración ${name}:`, err.message);
      throw err;
    }
    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
    console.log(`${name} aplicada.`);
  }

  console.log('Migración completa: base de datos y tablas listas.');
  await conn.end();
}

main().catch((err) => {
  console.error('Error en la migración:', err.message);
  process.exit(1);
});
