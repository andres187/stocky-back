import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as categoriesService from '../services/categoriesService.js';

export const categoriesRouter = Router();

categoriesRouter.get('/', async (req, res) => {
  res.json(await categoriesService.list());
});

categoriesRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json(await categoriesService.create(req.body?.label));
});

categoriesRouter.put('/:id', requireAuth, async (req, res) => {
  res.json(await categoriesService.update(req.params.id, req.body?.label));
});

categoriesRouter.delete('/:id', requireAuth, async (req, res) => {
  await categoriesService.remove(req.params.id);
  res.status(204).end();
});
