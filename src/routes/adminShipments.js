import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as shipmentsService from '../services/shipmentsService.js';

export const adminShipmentsRouter = Router();

adminShipmentsRouter.patch('/:id', requireAuth, async (req, res) => {
  res.json(await shipmentsService.updateStatus(req.params.id, req.body || {}));
});
