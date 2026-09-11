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

  if (!transaction) {
    throw new HttpError(502, 'No se pudo procesar el pago con el banco. Intenta de nuevo.');
  }

  // Wompi responde 2xx tanto para una tarjeta aprobada como rechazada — el resultado
  // viaja en transaction.status (APPROVED/DECLINED/...), no en el código HTTP. No se
  // lanza aquí por un DECLINED: el llamador decide qué hacer con cada estado (igual
  // que etniapp-core, que persiste la orden sin importar el resultado del cobro).
  return {
    wompiTransactionId: transaction.id,
    status: transaction.status,
    amountInCents: transaction.amount_in_cents,
    raw: transaction,
  };
}
