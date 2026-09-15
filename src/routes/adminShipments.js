import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as shipmentsService from '../services/shipmentsService.js';

export const adminShipmentsRouter = Router();

adminShipmentsRouter.get('/', requireAuth, async (req, res) => {
  res.json(await shipmentsService.listForAdmin({ status: req.query.status }));
});

adminShipmentsRouter.patch('/:id', requireAuth, async (req, res) => {
  const body = req.body || {};
  const actor = { type: 'admin', id: req.admin.sub };
  res.json(await shipmentsService.updateStatus(req.params.id, body, actor));
});
