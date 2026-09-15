// Confirmación de recibido, retención de 15 días antes de pagarle al vendedor,
// y solicitudes de devolución.
//
// El problema que resuelve del lado de la plata: hasta ahora la liquidación
// (sellerSalesService.js) sumaba toda venta pagada, para siempre, sin mirar si
// el envío llegó, si lo devolvieron, ni si ya se le pagó al vendedor. Aquí se
// agregan las tres piezas que faltaban para poder decidir eso.
//
// Guardas por código de error de MySQL, mismo patrón que 0001/0002/0003.

const SHIPMENT_STATUS_ENUM =
  "ENUM('pending','preparing','shipped','out_for_delivery','delivered','received','cancelled','returned')";

export async function up(conn) {
  // ------------------------------------------------ 1) 'received', 6º paso
  // 'delivered' lo pone el vendedor, que es parte interesada. 'received' solo
  // lo puede poner el comprador (o el job de auto-confirmación); es lo que
  // arranca el reloj de la retención.
  await conn.query(`ALTER TABLE shipments MODIFY COLUMN status ${SHIPMENT_STATUS_ENUM} NOT NULL DEFAULT 'pending'`);

  // Timestamps desnormalizados: la liquidación los consulta en cada reporte y
  // no puede estar re-derivándolos de shipment_status_history fila por fila.
  for (const ddl of [
    'ALTER TABLE shipments ADD COLUMN delivered_at TIMESTAMP NULL',
    'ALTER TABLE shipments ADD COLUMN received_at TIMESTAMP NULL',
    "ALTER TABLE shipments ADD COLUMN received_source ENUM('customer','auto','admin') NULL",
  ]) {
    try {
      await conn.query(ddl);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }

  // El job de auto-confirmación busca envíos entregados hace más de N días.
  try {
    await conn.query('ALTER TABLE shipments ADD INDEX idx_shipments_delivered (status, delivered_at)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  // Backfill: los envíos que ya estaban entregados antes de esta migración no
  // tienen delivered_at. Se toma del historial, que sí lo registró.
  await conn.query(`
    UPDATE shipments sh
    JOIN (
      SELECT shipment_id, MIN(created_at) AS at
      FROM shipment_status_history WHERE status = 'delivered' GROUP BY shipment_id
    ) h ON h.shipment_id = sh.id
    SET sh.delivered_at = h.at
    WHERE sh.delivered_at IS NULL
  `);

  // ------------------------------------------------ 2) el cliente como actor
  await conn.query(`
    ALTER TABLE shipment_status_history
    MODIFY COLUMN status ${SHIPMENT_STATUS_ENUM} NOT NULL
  `);
  await conn.query(`
    ALTER TABLE shipment_status_history
    MODIFY COLUMN actor_type ENUM('system','admin','seller','customer') NOT NULL DEFAULT 'system'
  `);

  // ------------------------------------------------ 3) devoluciones
  // UNIQUE(order_id): una solicitud por pedido. La devolución se pide por pedido
  // completo, no por artículo (decisión de producto, no limitación técnica).
  await conn.query(`
    CREATE TABLE IF NOT EXISTS return_requests (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL UNIQUE,
      customer_id INT NOT NULL,
      reason ENUM('no_llego','danado','no_corresponde','talla','otro') NOT NULL,
      body VARCHAR(1000) NULL,
      status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
      resolution_note VARCHAR(255) NULL,
      resolved_by INT NULL,
      resolved_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_return_status (status, created_at)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  for (const ddl of [
    'ALTER TABLE return_requests ADD CONSTRAINT fk_return_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE ON UPDATE RESTRICT',
    'ALTER TABLE return_requests ADD CONSTRAINT fk_return_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE ON UPDATE RESTRICT',
  ]) {
    try {
      await conn.query(ddl);
    } catch (err) {
      if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
    }
  }

  // ------------------------------------------------ 4) pagos al vendedor
  // Esto es lo que no existía: un registro de "a este vendedor ya le pagué".
  await conn.query(`
    CREATE TABLE IF NOT EXISTS seller_payouts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      seller_id INT NOT NULL,
      amount INT NOT NULL,
      note VARCHAR(255) NULL,
      paid_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_payouts_seller (seller_id, created_at)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  try {
    await conn.query(
      'ALTER TABLE seller_payouts ADD CONSTRAINT fk_payout_seller FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  // order_item_id es UNIQUE a propósito: es la garantía, a nivel de base de
  // datos, de que una misma venta no se puede pagar dos veces — aunque dos
  // admins den clic al mismo tiempo. La validación en el service es la primera
  // línea; esta es la que de verdad no se puede saltar.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS seller_payout_items (
      id INT PRIMARY KEY AUTO_INCREMENT,
      payout_id INT NOT NULL,
      order_item_id INT NOT NULL UNIQUE,
      gross INT NOT NULL,
      commission INT NOT NULL
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  for (const ddl of [
    'ALTER TABLE seller_payout_items ADD CONSTRAINT fk_payout_item_payout FOREIGN KEY (payout_id) REFERENCES seller_payouts(id) ON DELETE CASCADE ON UPDATE RESTRICT',
    'ALTER TABLE seller_payout_items ADD CONSTRAINT fk_payout_item_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE ON UPDATE RESTRICT',
  ]) {
    try {
      await conn.query(ddl);
    } catch (err) {
      if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
    }
  }
}
