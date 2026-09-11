import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as sizesService from '../services/sizesService.js';

export const sizesRouter = Router();

sizesRouter.get('/', async (req, res) => {
  res.json(await sizesService.list());
});

sizesRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json(await sizesService.create(req.body?.label));
});

sizesRouter.put('/:id', requireAuth, async (req, res) => {
  res.json(await sizesService.update(req.params.id, req.body?.label));
});

sizesRouter.delete('/:id', requireAuth, async (req, res) => {
  await sizesService.remove(req.params.id);
  res.status(204).end();
});
