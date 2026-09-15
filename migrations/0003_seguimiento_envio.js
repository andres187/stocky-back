// Línea de seguimiento del envío: amplía shipments.status de 3 a 7 estados y
// agrega la tabla de historial que le da una fecha a cada paso.
//
// 'pending' pasa a significar "pagado, aún sin preparar" — es el valor con el
// que ordersService.checkout ya crea la fila, así que los envíos existentes
// siguen siendo válidos y no hace falta traducir nada.
//
// Guardas por código de error de MySQL, mismo patrón que 0001_initial_schema.js
// y 0002_indices_rotacion.js, para que re-ejecutar la migración sea inofensivo.

const STATUS_ENUM = "ENUM('pending','preparing','shipped','out_for_delivery','delivered','cancelled','returned')";

export async function up(conn) {
  // MODIFY COLUMN es idempotente por naturaleza (deja la columna en el estado
  // declarado), así que no necesita guarda.
  await conn.query(`ALTER TABLE shipments MODIFY COLUMN status ${STATUS_ENUM} NOT NULL DEFAULT 'pending'`);

  // La transportadora se guarda como texto libre y no como FK a un catálogo:
  // hoy no hay integración con ninguna, es solo un dato para mostrarle al
  // cliente junto al número de guía.
  try {
    await conn.query('ALTER TABLE shipments ADD COLUMN carrier VARCHAR(80) NULL AFTER tracking_number');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }

  // Tabla append-only: shipments.status es el estado actual, esto es el "cuándo"
  // de cada paso. Sin ella la línea de seguimiento no podría mostrar fechas.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS shipment_status_history (
      id INT PRIMARY KEY AUTO_INCREMENT,
      shipment_id INT NOT NULL,
      status ${STATUS_ENUM} NOT NULL,
      note VARCHAR(255) NULL,
      actor_type ENUM('system','admin','seller') NOT NULL DEFAULT 'system',
      actor_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ssh_shipment (shipment_id, created_at)
    ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  // actor_id queda sin FK a propósito: apunta a admin_users o a sellers según
  // actor_type, y el historial nunca debe borrarse ni bloquearse por lo que le
  // pase a la cuenta que hizo el cambio.
  try {
    await conn.query(
      'ALTER TABLE shipment_status_history ADD CONSTRAINT fk_ssh_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE ON UPDATE RESTRICT'
    );
  } catch (err) {
    if (err.code !== 'ER_FK_DUP_NAME' && err.errno !== 1826) throw err;
  }

  // Backfill: sin esto, todo pedido anterior a esta migración mostraría una
  // línea de seguimiento sin ninguna fecha. Se usa created_at del envío como
  // fecha del primer paso, que es lo más cercano a la verdad que tenemos.
  await conn.query(`
    INSERT INTO shipment_status_history (shipment_id, status, actor_type, created_at)
    SELECT s.id, s.status, 'system', s.created_at
    FROM shipments s
    WHERE NOT EXISTS (SELECT 1 FROM shipment_status_history h WHERE h.shipment_id = s.id)
  `);
}
