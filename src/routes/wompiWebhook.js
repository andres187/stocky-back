import { Router } from 'express';
import * as wompiWebhookService from '../services/wompiWebhookService.js';

export const wompiWebhookRouter = Router();

// Público (lo llama Wompi, no un cliente autenticado) — la autenticidad se valida
// por firma (ver wompiWebhookService.isValidSignature), no por sesión.
wompiWebhookRouter.post('/', async (req, res) => {
  const result = await wompiWebhookService.handleEvent(req.body || {});
  res.json(result);
});
