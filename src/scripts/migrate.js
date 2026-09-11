import mysql from 'mysql2/promise';
import { config } from '../config.js';

async function main() {
  const dbName = config.db.name;

  let conn;
  try {
    conn = await mysql.createConnection({
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
    conn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: dbName,
    });
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(160) NOT NULL,
      category VARCHAR(60) NOT NULL,
      description VARCHAR(280) NOT NULL DEFAULT '',
      price INT NOT NULL,
      old_price INT NULL,
      image_url VARCHAR(500) NOT NULL,
      badge ENUM('new', 'low') NULL,
      colors JSON NOT NULL,
      sizes JSON NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      bestseller_order INT NULL,
      variant_stock JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  // Compatibilidad con bases creadas antes de agregar estas columnas.
  for (const ddl of [
    'ALTER TABLE products ADD COLUMN bestseller_order INT NULL',
    'ALTER TABLE products ADD COLUMN variant_stock JSON NULL',
  ]) {
    try {
      await conn.query(ddl);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }

  // La columna stock (por producto) quedó reemplazada por variant_stock (por combinación color+talla).
  try {
    await conn.query('ALTER TABLE products DROP COLUMN stock');
  } catch (err) {
    if (err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') throw err;
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT PRIMARY KEY AUTO_INCREMENT,
      slug VARCHAR(60) NOT NULL UNIQUE,
      label VARCHAR(80) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS colors (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(60) NOT NULL UNIQUE,
      hex VARCHAR(7) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS sizes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      label VARCHAR(20) NOT NULL UNIQUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  // Integridad referencial a nivel de BD: un producto no puede apuntar a una categoría
  // que no existe, y una categoría en uso no se puede borrar (evita el TOCTOU de
  // "contar productos y luego borrar" que existía antes en la ruta de categorías).
  try {
    await conn.query(
      'ALTER TABLE products ADD CONSTRAINT fk_products_category FOREIGN KEY (category) REFERENCES categories(slug) ON DELETE RESTRICT ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  // Índice para el filtro `WHERE active = 1` que corre en cada carga de la tienda.
  try {
    await conn.query('ALTER TABLE products ADD INDEX idx_products_active (active)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  console.log('Migración completa: base de datos y tablas listas.');
  await conn.end();
}

main().catch((err) => {
  console.error('Error en la migración:', err.message);
  process.exit(1);
});
