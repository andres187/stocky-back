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

async function main() {
  await seedAdmin();
  await seedCategories();
  await seedColors();
  await seedSizes();
  await seedProducts();
  await seedTestCustomer();
  await pool.end();
}

main().catch((err) => {
  console.error('Error sembrando datos:', err.message);
  process.exit(1);
});
