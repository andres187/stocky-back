import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as colorsService from '../services/colorsService.js';

export const colorsRouter = Router();

colorsRouter.get('/', async (req, res) => {
  res.json(await colorsService.list());
});

colorsRouter.post('/', requireAuth, async (req, res) => {
  res.status(201).json(await colorsService.create(req.body?.name, req.body?.hex));
});

colorsRouter.put('/:id', requireAuth, async (req, res) => {
  res.json(await colorsService.update(req.params.id, req.body?.name, req.body?.hex));
});

colorsRouter.delete('/:id', requireAuth, async (req, res) => {
  await colorsService.remove(req.params.id);
  res.status(204).end();
});
