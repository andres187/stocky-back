import crypto from 'crypto';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import * as ordersService from './ordersService.js';

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Checksum de Wompi: SHA-256 de los valores de `signature.properties` (en el orden
// dado, leídos del propio payload) + el timestamp del evento + la llave de eventos —
// nunca se procesa un evento sin verificar esto, cualquiera podría mandar un POST
// fingiendo que un pago se aprobó.
function isValidSignature(payload) {
  const { signature, timestamp, data } = payload;
  if (!signature?.checksum || !signature?.properties || !timestamp) return false;

  const concatenated = signature.properties.map((path) => String(getByPath({ data }, path) ?? '')).join('');
  const expected = crypto.createHash('sha256').update(`${concatenated}${timestamp}${config.wompi.eventsKey}`).digest('hex');

  return expected === signature.checksum;
}

export async function handleEvent(payload) {
  if (!isValidSignature(payload)) {
    throw new HttpError(401, 'Firma inválida.');
  }

  if (payload.event !== 'transaction.updated' && payload.event !== 'transaction.created') {
    return { ignored: true };
  }

  const transaction = payload.data?.transaction;
  if (!transaction?.id || !transaction?.status) {
    return { ignored: true };
  }

  const result = await ordersService.applyPaymentUpdate(transaction.id, transaction.status, transaction);
  return result || { ignored: true };
}
