import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as sellerSalesService from '../services/sellerSalesService.js';

export const adminSellerSalesRouter = Router();

adminSellerSalesRouter.get('/', requireAuth, async (req, res) => {
  res.json(await sellerSalesService.summaryForAdmin({ from: req.query.from, to: req.query.to }));
});
