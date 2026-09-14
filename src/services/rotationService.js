import { config } from '../config.js';

// Motor de rotación de la vitrina. La idea: el orden en que se ve la ropa no es
// aleatorio "por petición" sino aleatorio "por ventana de tiempo". Todo el mundo
// que entra dentro de la misma hora ve exactamente el mismo orden, y a la hora
// siguiente cambia. Así la vitrina se renueva sola sin que el catálogo baile
// mientras alguien pagina, y la respuesta se puede cachear.
//
// Este módulo es puro a propósito: no toca la base de datos ni req/res. Solo
// semillas, mezcla determinista y la caché en memoria de la ventana actual.

export const ROTATION_WINDOW_MS = config.rotation.windowMs;

// Semilla global de la ventana actual. Misma ventana ⇒ misma semilla ⇒ mismo orden.
export function currentSeed(now = Date.now()) {
  return Math.floor(now / ROTATION_WINDOW_MS);
}

// Segundos que le quedan de vida a la ventana actual. Alimenta el max-age de
// Cache-Control: la respuesta deja de ser válida justo cuando cambia el orden.
export function secondsUntilNextWindow(now = Date.now()) {
  return Math.max(1, Math.ceil((ROTATION_WINDOW_MS - (now % ROTATION_WINDOW_MS)) / 1000));
}

// mulberry32: generador pseudoaleatorio sembrable de 32 bits. Hace falta uno
// propio porque Math.random no acepta semilla y crypto no es reproducible, y sin
// reproducibilidad no se puede cachear ni depurar el orden.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates con la semilla dada. Devuelve una copia; nunca muta la entrada.
export function seededShuffle(items, seed) {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Misma semántica que variantStockFor en el front (web/src/context/CartContext.jsx):
// una prenda sin variantStock, o con la lista vacía, se considera disponible (el
// front la trata como sin límite). Solo está agotada si declara combinaciones y
// todas están en 0.
export function hasStock(product) {
  const variants = product?.variantStock;
  if (!Array.isArray(variants) || variants.length === 0) return true;
  return variants.some((v) => Number(v?.stock) > 0);
}

// Reparte las prendas ya mezcladas en round-robin por categoría, para que la
// primera página no quede entera de la misma categoría. El orden en que entran
// las categorías también depende de la semilla, si no la misma categoría abriría
// la vitrina siempre.
export function interleaveByCategory(items, seed) {
  const queues = new Map();
  for (const item of items) {
    const cat = item?.cat ?? '';
    if (!queues.has(cat)) queues.set(cat, []);
    queues.get(cat).push(item);
  }
  if (queues.size < 2) return [...items];

  const order = seededShuffle([...queues.keys()], seed);
  const out = [];
  while (out.length < items.length) {
    for (const cat of order) {
      const queue = queues.get(cat);
      if (queue.length > 0) out.push(queue.shift());
    }
  }
  return out;
}

// --- Caché de la ventana actual ----------------------------------------------
// Mismo patrón que la caché de bancos PSE en paymentService.js: variables de
// módulo, sin dependencias nuevas. Aquí la "expiración" es el cambio de semilla:
// al detectar una ventana nueva se tira el mapa entero, así nunca crece.

let cachedSeed = null;
const cache = new Map();

// Guarda la promesa, no el valor, para que dos peticiones simultáneas no lancen
// la misma consulta dos veces. Si falla, se saca para no dejar el error pegado.
export function withCache(key, producer) {
  const seed = currentSeed();
  if (cachedSeed !== seed) {
    cache.clear();
    cachedSeed = seed;
  }

  const hit = cache.get(key);
  if (hit) return hit;

  const pending = Promise.resolve(producer(seed)).catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, pending);
  return pending;
}

// La llaman las escrituras de producto. Sin esto, un admin que edita una prenda
// no vería el cambio en la tienda hasta la ventana siguiente.
export function invalidate() {
  cache.clear();
  cachedSeed = null;
}
