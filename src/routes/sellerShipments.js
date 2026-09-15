import { Router } from 'express';
import { requireSellerAuth } from '../middleware/sellerAuth.js';
import * as shipmentsService from '../services/shipmentsService.js';

export const sellerShipmentsRouter = Router();

sellerShipmentsRouter.get('/', requireSellerAuth, async (req, res) => {
  res.json(await shipmentsService.listForSeller(req.seller.sub, { status: req.query.status }));
});

sellerShipmentsRouter.patch('/:id', requireSellerAuth, async (req, res) => {
  await shipmentsService.assertSellerOwnsShipment(req.seller.sub, req.params.id);
  const body = req.body || {};
  const actor = { type: 'seller', id: req.seller.sub };
  res.json(await shipmentsService.updateStatus(req.params.id, body, actor));
});
