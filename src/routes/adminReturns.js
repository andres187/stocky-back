import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as returnsService from '../services/returnsService.js';

export const adminReturnsRouter = Router();

adminReturnsRouter.get('/', requireAuth, async (req, res) => {
  res.json(await returnsService.listForAdmin({ status: req.query.status }));
});

adminReturnsRouter.patch('/:id', requireAuth, async (req, res) => {
  const body = req.body || {};
  res.json(await returnsService.resolve(req.params.id, body, req.admin.sub));
});
