import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as productsService from '../services/productsService.js';
import * as reviewsService from '../services/reviewsService.js';

export const productsRouter = Router();

// GET /api/products?categoria=vestidos — público, usado por la tienda
productsRouter.get('/', async (req, res) => {
  res.json(await productsService.listPublic(req.query.categoria));
});

// GET /api/products/admin — todo el catálogo, incluidos inactivos (protegido)
productsRouter.get('/admin', requireAuth, async (req, res) => {
  res.json(await productsService.listAdmin());
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
