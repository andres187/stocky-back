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

  // Dueños de la ropa (consignación): registran su cuenta desde la tienda y quedan
  // 'pending' hasta que un admin las aprueba. commission_rate es el % que se queda
  // la tienda sobre cada venta suya.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS sellers (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(160) NOT NULL,
      phone VARCHAR(30) NULL,
      commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
      status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
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
    // NULL = producto de la tienda (el catálogo que existía antes de los dueños).
    'ALTER TABLE products ADD COLUMN seller_id INT NULL',
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

  try {
    await conn.query(
      'ALTER TABLE products ADD CONSTRAINT fk_products_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  try {
    await conn.query('ALTER TABLE products ADD INDEX idx_products_seller (seller_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
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
      password_hash VARCHAR(255) NULL,
      full_name VARCHAR(160) NOT NULL,
      last_name VARCHAR(80) NULL,
      region_code VARCHAR(6) NULL,
      phone VARCHAR(30) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  // Un cliente que entra con código OTP nunca tiene contraseña, así que password_hash
  // deja de ser obligatorio. El login por correo+contraseña sigue exigiéndolo en su
  // propio camino (customerAuthService.login rechaza al cliente sin hash).
  await conn.query('ALTER TABLE customers MODIFY password_hash VARCHAR(255) NULL');

  for (const column of ['last_name VARCHAR(80) NULL', 'region_code VARCHAR(6) NULL']) {
    try {
      await conn.query(`ALTER TABLE customers ADD COLUMN ${column}`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }

  // El celular es un identificador de login, así que tiene que ser único — pero solo
  // junto al prefijo de país: +57 300... y +52 300... son personas distintas. MySQL
  // permite repetir NULL en un índice único, así que los clientes viejos sin celular
  // (los que se registraron con correo+contraseña) no chocan entre sí.
  try {
    await conn.query('ALTER TABLE customers ADD UNIQUE KEY uq_customers_phone (region_code, phone)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  // OTP por correo: el código se genera y valida aquí (equivalente a la tabla
  // email_otps de etniapp-core). El OTP por SMS no necesita tabla porque el código
  // lo guarda y lo valida Twilio Verify.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS customer_email_otps (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(190) NOT NULL,
      code VARCHAR(6) NOT NULL,
      expires_at DATETIME NOT NULL,
      used TINYINT(1) NOT NULL DEFAULT 0,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_customer_email_otps_email (email)
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
      unit_price INT NOT NULL,
      seller_id INT NULL,
      commission_rate DECIMAL(5,2) NULL
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  // Snapshots al momento de la compra, misma razón que product_name/unit_price: si
  // mañana cambia la comisión del dueño o el producto pasa a otro dueño, la
  // liquidación histórica no se mueve. A propósito sin FK a sellers — el historial
  // nunca debe bloquear el borrado de un dueño.
  for (const ddl of [
    'ALTER TABLE order_items ADD COLUMN seller_id INT NULL',
    'ALTER TABLE order_items ADD COLUMN commission_rate DECIMAL(5,2) NULL',
  ]) {
    try {
      await conn.query(ddl);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }

  try {
    await conn.query('ALTER TABLE order_items ADD INDEX idx_order_items_seller (seller_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

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

  // Comentarios/reseñas que un cliente deja sobre un producto. `order_id` es
  // nullable y sin FK "dura" a propósito: identifica la compra verificada que
  // originó el comentario (para mostrarlo como "compra verificada"), pero un
  // comentario nunca debe desaparecer ni bloquearse por lo que le pase al pedido.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id INT PRIMARY KEY AUTO_INCREMENT,
      customer_id INT NOT NULL,
      product_id INT NOT NULL,
      order_id INT NULL,
      rating TINYINT NOT NULL,
      body VARCHAR(1000) NULL,
      status ENUM('published', 'hidden') NOT NULL DEFAULT 'published',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  try {
    await conn.query(
      'ALTER TABLE product_reviews ADD CONSTRAINT fk_product_reviews_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  try {
    await conn.query(
      'ALTER TABLE product_reviews ADD CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  try {
    await conn.query(
      'ALTER TABLE product_reviews ADD CONSTRAINT fk_product_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  // Un comentario por cliente y producto — para editarlo se usa PATCH, no un
  // segundo POST.
  try {
    await conn.query('ALTER TABLE product_reviews ADD UNIQUE KEY uq_product_reviews_customer_product (customer_id, product_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  try {
    await conn.query('ALTER TABLE product_reviews ADD INDEX idx_product_reviews_product (product_id)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  try {
    await conn.query('ALTER TABLE product_reviews ADD INDEX idx_product_reviews_customer (customer_id)');
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
