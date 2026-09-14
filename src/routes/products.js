import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as productsService from '../services/productsService.js';
import * as reviewsService from '../services/reviewsService.js';
import { secondsUntilNextWindow } from '../services/rotationService.js';

export const productsRouter = Router();

// La vitrina rota por ventana de tiempo (ver rotationService.js): el mismo orden
// es válido hasta que cambie la ventana, así que se puede cachear exactamente
// hasta ese instante. Cache-Control público porque no depende de la sesión.
function setRotationCache(res) {
  res.set('Cache-Control', `public, max-age=${secondsUntilNextWindow()}`);
}

// GET /api/products?categoria=vestidos — público, usado por la tienda
productsRouter.get('/', async (req, res) => {
  setRotationCache(res);
  res.json(await productsService.listPublic(req.query.categoria));
});

// GET /api/products/admin — todo el catálogo, incluidos inactivos (protegido)
productsRouter.get('/admin', requireAuth, async (req, res) => {
  res.json(await productsService.listAdmin());
});

// GET /api/products/destacados?limit= — público. "Más vendidos" real: ventas
// pagadas de las últimas 48h, con relleno por curaduría manual y novedades.
// Debe ir antes de /:id para no ser tragada por esa ruta.
productsRouter.get('/destacados', async (req, res) => {
  setRotationCache(res);
  res.json(await productsService.destacados(req.query.limit));
});

// GET /api/products/sugeridos?ref=&ref=&categoria=&limit= — público. Franja
// "También te puede gustar". También debe ir antes de /:id.
productsRouter.get('/sugeridos', async (req, res) => {
  const refs = [].concat(req.query.ref ?? []);
  setRotationCache(res);
  res.json(
    await productsService.sugeridos({
      refs,
      categoria: req.query.categoria,
      limit: req.query.limit,
    })
  );
});

productsRouter.get('/:id', async (req, res) => {
  res.json(await productsService.getById(req.params.id));
});

// GET /api/products/:id/reviews — público, comentarios publicados de un producto
productsRouter.get('/:id/reviews', async (req, res) => {
  res.json(await reviewsService.listForProduct(req.params.id));
});

productsRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json(await productsService.create(req.body));
});

productsRouter.put('/:id', requireAuth, async (req, res) => {
  res.json(await productsService.update(req.params.id, req.body));
});

productsRouter.delete('/:id', requireAuth, async (req, res) => {
  await productsService.remove(req.params.id);
  res.status(204).end();
});
