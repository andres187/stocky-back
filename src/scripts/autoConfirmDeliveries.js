// Auto-confirmación de recibido.
//
// Si el comprador nunca da clic en "ya lo recibí", la plata del vendedor queda
// congelada para siempre. A los AUTO_CONFIRM_DAYS días de "entregado" se da por
// recibido y arranca la retención normal de RECEIPT_HOLD_DAYS.
//
// Pensado para un cron externo (`npm run jobs:auto-confirm`), igual que migrate
// y seed — el backend no tiene scheduler propio y no vale la pena meter uno
// por un job diario.
//
// Si este job deja de correr, nada se rompe hacia el lado peligroso: las ventas
// se quedan retenidas y no se libera plata de más. Es la dirección correcta del
// fallo.
import { pool } from '../db/pool.js';
import { AUTO_CONFIRM_DAYS } from '../services/reportsService.js';
import * as shipmentsService from '../services/shipmentsService.js';

async function main() {
  const [rows] = await pool.query(
    `SELECT id FROM shipments
     WHERE status = 'delivered'
       AND received_at IS NULL
       AND delivered_at IS NOT NULL
       AND delivered_at <= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [AUTO_CONFIRM_DAYS]
  );

  if (rows.length === 0) {
    console.log('No hay envíos entregados pendientes de auto-confirmar.');
    await pool.end();
    return;
  }

  let confirmed = 0;
  for (const row of rows) {
    // Uno por uno y con su propio try: un envío que falle (p.ej. porque alguien
    // lo movió a 'returned' entre el SELECT y el UPDATE) no debe tumbar el resto.
    try {
      await shipmentsService.updateStatus(
        row.id,
        { status: 'received', receivedSource: 'auto', note: `Auto-confirmado a los ${AUTO_CONFIRM_DAYS} días de la entrega.` },
        { type: 'system', id: null }
      );
      confirmed++;
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', scope: 'auto-confirm', shipmentId: row.id, message: err.message }));
    }
  }

  console.log(`${confirmed} de ${rows.length} envíos auto-confirmados como recibidos.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Error auto-confirmando entregas:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
