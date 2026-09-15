import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

const COLORS = {
  rosa: { name: 'Rosa', hex: '#d59aa2' },
  arena: { name: 'Arena', hex: '#cdbba0' },
  negro: { name: 'Negro', hex: '#2b2622' },
  salvia: { name: 'Salvia', hex: '#93a889' },
  blanco: { name: 'Blanco', hex: '#f5f1ea' },
  lila: { name: 'Lila', hex: '#b6a0c9' },
};
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const c = (...keys) => keys.map((k) => COLORS[k]);

const CATEGORIES = [
  { slug: 'vestidos', label: 'Vestidos' },
  { slug: 'blusas', label: 'Blusas' },
  { slug: 'pantalones', label: 'Pantalones' },
  { slug: 'abrigos', label: 'Abrigos' },
];

const PRODUCTS = [
  { name: 'Vestido Aurora', category: 'vestidos', description: 'Lino pesado, corte bias.', price: 249000, imageUrl: 'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?fm=jpg&q=75&w=800&auto=format&fit=crop', badge: 'new', colors: c('rosa', 'arena', 'negro'), sizes: SIZES, bestsellerOrder: 1 },
  { name: 'Vestido Solene', category: 'vestidos', description: 'Seda mate, cuello estructurado.', price: 279000, oldPrice: 349000, imageUrl: 'https://images.unsplash.com/photo-1614786269829-d24616faf56d?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('negro', 'arena'), sizes: SIZES },
  { name: 'Vestido Nervi', category: 'vestidos', description: 'Corte midi, manga larga.', price: 229000, imageUrl: 'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?fm=jpg&q=75&w=800&auto=format&fit=crop', badge: 'low', colors: c('salvia', 'negro', 'arena'), sizes: SIZES },
  { name: 'Vestido Duna', category: 'vestidos', description: 'Estampado floral, plisado frontal.', price: 199000, imageUrl: 'https://images.unsplash.com/photo-1511130558090-00af810c21b1?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('rosa', 'blanco'), sizes: SIZES },
  { name: 'Vestido Camélia', category: 'vestidos', description: 'Viscosa fluida, cinturón anudado.', price: 259000, imageUrl: 'https://images.unsplash.com/photo-1616313253719-c46514cddee1?fm=jpg&q=75&w=800&auto=format&fit=crop', badge: 'new', colors: c('rosa', 'lila', 'negro'), sizes: SIZES, bestsellerOrder: 2 },
  { name: 'Vestido Lago', category: 'vestidos', description: 'Corte asimétrico, tono sólido.', price: 269000, oldPrice: 320000, imageUrl: 'https://images.unsplash.com/photo-1495385794356-15371f348c31?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('salvia', 'negro'), sizes: SIZES },
  { name: 'Blusa Iris', category: 'blusas', description: 'Popelín ligero, mangas abullonadas.', price: 149000, imageUrl: 'https://images.unsplash.com/photo-1671848633245-79cc98b0dbe8?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('blanco', 'rosa', 'lila'), sizes: SIZES },
  { name: 'Blusa Odette', category: 'blusas', description: 'Seda ligera, cuello lazo.', price: 159000, oldPrice: 199000, imageUrl: 'https://images.unsplash.com/photo-1579328064848-53fe6c665058?fm=jpg&q=75&w=800&auto=format&fit=crop', badge: 'low', colors: c('blanco', 'negro'), sizes: SIZES },
  { name: 'Vestido Bruma', category: 'vestidos', description: 'Enterizo silueta suelta.', price: 269000, imageUrl: 'https://images.unsplash.com/photo-1753192108753-81be0db2f7fe?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('arena', 'salvia'), sizes: SIZES },
  { name: 'Vestido Ámbar', category: 'vestidos', description: 'Punto acanalado, corte midi.', price: 259000, imageUrl: 'https://images.unsplash.com/photo-1534875756527-5e8e4392005f?fm=jpg&q=75&w=800&auto=format&fit=crop', badge: 'new', colors: c('lila', 'negro', 'arena'), sizes: SIZES },
  { name: 'Abrigo Merano', category: 'abrigos', description: 'Gabardina técnica, forro térmico.', price: 389000, imageUrl: 'https://images.unsplash.com/photo-1602010069450-0a62034f235c?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('arena', 'negro'), sizes: SIZES, bestsellerOrder: 3 },
  { name: 'Vestido Mira', category: 'vestidos', description: 'Corte campana, tejido liviano.', price: 219000, imageUrl: 'https://images.unsplash.com/photo-1599662875272-64de8289f6d8?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('rosa', 'blanco', 'salvia'), sizes: SIZES },
  { name: 'Pantalón Coral', category: 'pantalones', description: 'Sastrería recta, tiro alto.', price: 209000, imageUrl: 'https://images.unsplash.com/photo-1563178406-4cdc2923acbc?fm=jpg&q=75&w=800&auto=format&fit=crop', badge: 'new', colors: c('arena', 'negro'), sizes: SIZES },
  { name: 'Vestido Tácito', category: 'vestidos', description: 'Algodón satinado, línea A.', price: 239000, oldPrice: 279000, imageUrl: 'https://images.unsplash.com/photo-1478146896981-b80fe463b330?fm=jpg&q=75&w=800&auto=format&fit=crop', colors: c('negro', 'lila'), sizes: SIZES },
  { name: 'Vestido Marea', category: 'vestidos', description: 'Corte cruzado, manga corta.', price: 249000, imageUrl: 'https://images.unsplash.com/photo-1619794724492-651397287d94?fm=jpg&q=75&w=800&auto=format&fit=crop', badge: 'low', colors: c('rosa', 'arena', 'blanco'), sizes: SIZES },
];

async function seedAdmin() {
  const { username, password } = config.admin;
  if (!username || !password) {
    console.error('Faltan ADMIN_USERNAME/ADMIN_PASSWORD en .env — no se puede crear el admin inicial.');
    process.exit(1);
  }
  const [rows] = await pool.query('SELECT id FROM admins WHERE username = ?', [username]);
  if (rows.length > 0) {
    console.log(`El admin "${username}" ya existe, no se duplica.`);
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hash]);
  console.log(`Admin "${username}" creado.`);
}

async function seedCategories() {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM categories');
  if (rows[0].count > 0) {
    console.log('Ya hay categorías, no se vuelven a sembrar.');
    return;
  }
  for (const [i, cat] of CATEGORIES.entries()) {
    await pool.query('INSERT INTO categories (slug, label, sort_order) VALUES (?, ?, ?)', [cat.slug, cat.label, i + 1]);
  }
  console.log(`${CATEGORIES.length} categorías sembradas.`);
}

async function seedColors() {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM colors');
  if (rows[0].count > 0) {
    console.log('Ya hay colores, no se vuelven a sembrar.');
    return;
  }
  for (const color of Object.values(COLORS)) {
    await pool.query('INSERT INTO colors (name, hex) VALUES (?, ?)', [color.name, color.hex]);
  }
  console.log(`${Object.keys(COLORS).length} colores sembrados.`);
}

async function seedSizes() {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM sizes');
  if (rows[0].count > 0) {
    console.log('Ya hay tallas, no se vuelven a sembrar.');
    return;
  }
  const allSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  for (const [i, label] of allSizes.entries()) {
    await pool.query('INSERT INTO sizes (label, sort_order) VALUES (?, ?)', [label, i + 1]);
  }
  console.log(`${allSizes.length} tallas sembradas.`);
}

async function seedProducts() {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM products');
  if (rows[0].count > 0) {
    console.log('Ya hay productos en la base de datos, no se vuelve a sembrar el catálogo.');
    return;
  }
  for (const p of PRODUCTS) {
    await pool.query(
      `INSERT INTO products (name, category, description, price, old_price, image_url, badge, colors, sizes, active, bestseller_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        p.name,
        p.category,
        p.description,
        p.price,
        p.oldPrice || null,
        p.imageUrl,
        p.badge || null,
        JSON.stringify(p.colors),
        JSON.stringify(p.sizes),
        p.bestsellerOrder || null,
      ]
    );
  }
  console.log(`${PRODUCTS.length} productos sembrados.`);
}

async function seedTestCustomer() {
  const email = 'cliente.prueba@stocky.test';
  const [rows] = await pool.query('SELECT id FROM customers WHERE email = ?', [email]);
  if (rows.length > 0) {
    console.log('El cliente de prueba ya existe, no se duplica.');
    return;
  }
  const hash = await bcrypt.hash('prueba1234', 12);
  await pool.query(
    'INSERT INTO customers (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)',
    [email, hash, 'Cliente de Prueba', '3001234567']
  );
  console.log(`Cliente de prueba "${email}" creado (contraseña: prueba1234).`);
}

// Sin esto no hay forma de ver la línea de seguimiento del envío en la app/web
// sin pasar por un checkout real contra Wompi. Crea, para el cliente de prueba,
// un pedido ya pagado con dos artículos y un historial de envío de 3 pasos con
// fechas escalonadas (recibido → en preparación → enviado), para poder ver los
// pasos ya cumplidos y los pendientes de una sola vez.
async function seedSampleShipment() {
  const email = 'cliente.prueba@stocky.test';
  const [customers] = await pool.query('SELECT id FROM customers WHERE email = ?', [email]);
  const customerId = customers[0]?.id;
  if (!customerId) {
    console.log('No existe el cliente de prueba, se omite el pedido de ejemplo.');
    return;
  }

  const [existingOrders] = await pool.query('SELECT id FROM orders WHERE customer_id = ?', [customerId]);
  if (existingOrders.length > 0) {
    console.log('El cliente de prueba ya tiene pedidos, no se crea uno de ejemplo.');
    return;
  }

  const [products] = await pool.query('SELECT id, name, price, colors, sizes FROM products LIMIT 4');
  if (products.length < 4) {
    console.log('No hay suficientes productos sembrados para armar los pedidos de ejemplo.');
    return;
  }

  // Tres pedidos, cada uno en un punto distinto del ciclo de pago al vendedor
  // (ver reportsService.PAYOUT_STATE_SQL), para poder probar los tres casos
  // sin tener que mover fechas a mano:
  //   STK-DEMO01: enviado ayer — 'pending' de cara al pago.
  //   STK-DEMO02: recibido hace 20 días — ya 'available' para pagarle al vendedor.
  //   STK-DEMO03: entregado hace 8 días, nunca confirmado — listo para que
  //               jobs:auto-confirm lo pase a 'received'.
  const DEMO_ORDERS = [
    {
      reference: 'STK-DEMO01',
      productIndex: 0,
      shipmentStatus: 'shipped',
      history: [['pending', 3], ['preparing', 2], ['shipped', 1]],
    },
    {
      reference: 'STK-DEMO02',
      productIndex: 1,
      shipmentStatus: 'received',
      history: [['pending', 25], ['preparing', 24], ['shipped', 23], ['out_for_delivery', 21], ['delivered', 20], ['received', 20]],
      deliveredDaysAgo: 20,
      receivedDaysAgo: 20,
      receivedSource: 'customer',
    },
    {
      reference: 'STK-DEMO03',
      productIndex: 2,
      shipmentStatus: 'delivered',
      history: [['pending', 12], ['preparing', 11], ['shipped', 10], ['out_for_delivery', 9], ['delivered', 8]],
      deliveredDaysAgo: 8,
    },
  ];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const demo of DEMO_ORDERS) {
      const p = products[demo.productIndex];
      const colors = typeof p.colors === 'string' ? JSON.parse(p.colors) : p.colors;
      const sizes = typeof p.sizes === 'string' ? JSON.parse(p.sizes) : p.sizes;
      const shippingCost = 15000;
      const total = p.price + shippingCost;

      const [orderResult] = await conn.query(
        `INSERT INTO orders (customer_id, reference, status, subtotal, shipping_cost, total, shipping_name, shipping_email, shipping_phone, shipping_address, shipping_city)
         VALUES (?, ?, 'paid', ?, ?, ?, 'Cliente de Prueba', ?, '3001234567', 'Calle 10 # 20-30', 'Bogotá')`,
        [customerId, demo.reference, p.price, shippingCost, total, email]
      );
      const orderId = orderResult.insertId;

      await conn.query(
        'INSERT INTO order_items (order_id, product_id, product_name, color, size, quantity, unit_price) VALUES (?, ?, ?, ?, ?, 1, ?)',
        [orderId, p.id, p.name, colors[0]?.name || 'Único', sizes[0] || 'M', p.price]
      );

      const [shipmentResult] = await conn.query(
        'INSERT INTO shipments (order_id, status, carrier) VALUES (?, ?, ?)',
        [orderId, demo.shipmentStatus, 'Servientrega']
      );
      const shipmentId = shipmentResult.insertId;

      for (const [status, daysAgo] of demo.history) {
        await conn.query(
          "INSERT INTO shipment_status_history (shipment_id, status, actor_type, created_at) VALUES (?, ?, 'system', DATE_SUB(NOW(), INTERVAL ? DAY))",
          [shipmentId, status, daysAgo]
        );
      }

      if (demo.deliveredDaysAgo != null) {
        await conn.query('UPDATE shipments SET delivered_at = DATE_SUB(NOW(), INTERVAL ? DAY) WHERE id = ?', [demo.deliveredDaysAgo, shipmentId]);
      }
      if (demo.receivedDaysAgo != null) {
        await conn.query(
          'UPDATE shipments SET received_at = DATE_SUB(NOW(), INTERVAL ? DAY), received_source = ? WHERE id = ?',
          [demo.receivedDaysAgo, demo.receivedSource, shipmentId]
        );
      }
    }

    await conn.commit();
    console.log('3 pedidos de ejemplo creados para el cliente de prueba (STK-DEMO01 shipped, STK-DEMO02 received hace 20 días, STK-DEMO03 delivered hace 8 días).');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function main() {
  await seedAdmin();
  await seedCategories();
  await seedColors();
  await seedSizes();
  await seedProducts();
  await seedTestCustomer();
  await seedSampleShipment();
  await pool.end();
}

main().catch((err) => {
  console.error('Error sembrando datos:', err.message);
  process.exit(1);
});
