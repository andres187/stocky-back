// Índices para las consultas nuevas de rotationService.js/productsService.js:
// la vitrina filtra products.category y destacados() filtra+agrupa orders por
// status+created_at. Ninguna de las dos tenía índice hasta ahora. Guardas por
// código de error de MySQL, mismo patrón que 0001_initial_schema.js, para que
// sea inofensivo re-ejecutar esta migración contra una base que ya la tiene.
export async function up(conn) {
  // listPublic() filtra `WHERE p.active = 1 AND p.category = ?` en cada carga de
  // categoría de la tienda; solo `active` tenía índice.
  try {
    await conn.query('ALTER TABLE products ADD INDEX idx_products_category (category)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }

  // destacados() agrupa order_items por pedidos con status='paid' y
  // created_at dentro de las últimas 48h; orders solo tenía índice por customer_id.
  try {
    await conn.query('ALTER TABLE orders ADD INDEX idx_orders_status_created (status, created_at)');
  } catch (err) {
    if (err.code !== 'ER_DUP_KEYNAME') throw err;
  }
}
