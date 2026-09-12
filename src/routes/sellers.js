import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as sellersService from '../services/sellersService.js';

// Gestión de dueños desde el admin. No hay POST: el alta la hace el propio dueño
// en /api/seller-auth/register y el admin solo aprueba o rechaza.
export const sellersRouter = Router();

sellersRouter.get('/', requireAuth, async (req, res) => {
  res.json(await sellersService.list());
});

sellersRouter.patch('/:id', requireAuth, async (req, res) => {
  res.json(await sellersService.update(req.params.id, {
    status: req.body?.status,
    commissionRate: req.body?.commissionRate,
  }));
});

sellersRouter.delete('/:id', requireAuth, async (req, res) => {
  await sellersService.remove(req.params.id);
  res.status(204).end();
});
