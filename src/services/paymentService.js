import crypto from 'crypto';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export function computeSignature(reference, amountInCents, currency) {
  return crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${config.wompi.integrityKey}`)
    .digest('hex');
}

// Cobra una tarjeta ya tokenizada por Wompi en el cliente (este backend nunca ve
// un PAN crudo). Lanza ANTES de cualquier escritura en DB: el llamador depende de
// esto para garantizar que una orden solo se persiste si el cobro fue aprobado.
export async function chargeCard({ reference, amountInCents, currency, customerEmail, cardPaymentMethod }) {
  const signature = computeSignature(reference, amountInCents, currency);

  let res;
  try {
    res = await fetch(`${config.wompi.baseUrl}/transactions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.wompi.privateKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': reference,
      },
      body: JSON.stringify({
        amount_in_cents: amountInCents,
        currency,
        customer_email: customerEmail,
        payment_method: { type: 'CARD', ...cardPaymentMethod },
        reference,
        signature,
      }),
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', scope: 'wompi', reference, message: err.message }));
    throw new HttpError(502, 'No se pudo procesar el pago con el banco. Intenta de nuevo.');
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new HttpError(502, 'No se pudo procesar el pago con el banco. Intenta de nuevo.');
  }

  if (!res.ok) {
    console.error(JSON.stringify({ level: 'error', scope: 'wompi', reference, httpStatus: res.status }));
    throw new HttpError(502, 'No se pudo procesar el pago con el banco. Intenta de nuevo.');
  }

  const transaction = body.data;

  if (!transaction || transaction.status !== 'APPROVED') {
    console.error(JSON.stringify({
      level: 'warn', scope: 'wompi', reference, wompiStatus: transaction?.status,
    }));
    throw new HttpError(402, { error: 'El pago fue rechazado por el banco.', wompiStatus: transaction?.status || 'ERROR' });
  }

  return {
    wompiTransactionId: transaction.id,
    status: transaction.status,
    amountInCents: transaction.amount_in_cents,
    raw: transaction,
  };
}
