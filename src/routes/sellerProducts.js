import { Router } from 'express';
import { requireSellerAuth } from '../middleware/sellerAuth.js';
import * as productsService from '../services/productsService.js';
import * as sellerSalesService from '../services/sellerSalesService.js';

// Portal del dueño: todo va filtrado por req.seller.sub, nunca por un id del body.
export const sellerRouter = Router();

sellerRouter.use(requireSellerAuth);

sellerRouter.get('/products', async (req, res) => {
  res.json(await productsService.listForSeller(req.seller.sub));
});

sellerRouter.get('/products/:id', async (req, res) => {
  res.json(await productsService.getForSeller(req.seller.sub, req.params.id));
});

sellerRouter.post('/products', async (req, res) => {
  res.status(201).json(await productsService.createForSeller(req.seller.sub, req.body));
});

sellerRouter.put('/products/:id', async (req, res) => {
  res.json(await productsService.updateForSeller(req.seller.sub, req.params.id, req.body));
});

sellerRouter.delete('/products/:id', async (req, res) => {
  await productsService.removeForSeller(req.seller.sub, req.params.id);
  res.status(204).end();
});

sellerRouter.get('/sales', async (req, res) => {
  res.json(await sellerSalesService.listForSeller(req.seller.sub, { from: req.query.from, to: req.query.to }));
});
