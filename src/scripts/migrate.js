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

  await conn.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(160) NOT NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      customer_id INT NOT NULL,
      reference VARCHAR(64) NOT NULL UNIQUE,
      idempotency_key VARCHAR(64) NULL,
      status ENUM('pending', 'paid', 'failed') NOT NULL DEFAULT 'pending',
      subtotal INT NOT NULL,
      shipping_cost INT NOT NULL,
      total INT NOT NULL,
      shipping_name VARCHAR(160) NOT NULL,
      shipping_email VARCHAR(190) NOT NULL,
      shipping_phone VARCHAR(30) NOT NULL,
      shipping_address VARCHAR(255) NOT NULL,
      shipping_city VARCHAR(120) NOT NULL,
      notes VARCHAR(280) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  try {
    await conn.query(
      'ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  try {
    await conn.query('ALTER TABLE orders ADD UNIQUE KEY uq_orders_customer_idempotency (customer_id, idempotency_key)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  try {
    await conn.query('ALTER TABLE orders ADD INDEX idx_orders_customer (customer_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(160) NOT NULL,
      color VARCHAR(60) NOT NULL,
      size VARCHAR(20) NOT NULL,
      quantity INT NOT NULL,
      unit_price INT NOT NULL
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  try {
    await conn.query(
      'ALTER TABLE order_items ADD CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  try {
    await conn.query(
      'ALTER TABLE order_items ADD CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  try {
    await conn.query('ALTER TABLE order_items ADD INDEX idx_order_items_order (order_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  try {
    await conn.query('ALTER TABLE order_items ADD INDEX idx_order_items_product (product_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS shipments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL UNIQUE,
      status ENUM('pending', 'shipped', 'delivered') NOT NULL DEFAULT 'pending',
      tracking_number VARCHAR(100) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  try {
    await conn.query(
      'ALTER TABLE shipments ADD CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL UNIQUE,
      wompi_transaction_id VARCHAR(64) NOT NULL UNIQUE,
      status VARCHAR(30) NOT NULL,
      amount_in_cents BIGINT NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'COP',
      payment_method_type VARCHAR(30) NOT NULL,
      raw_response JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  try {
    await conn.query(
      'ALTER TABLE payment_transactions ADD CONSTRAINT fk_payment_transactions_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  console.log('Migración completa: base de datos y tablas listas.');
  await conn.end();
}

main().catch((err) => {
  console.error('Error en la migración:', err.message);
  process.exit(1);
});
