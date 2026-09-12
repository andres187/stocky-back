import crypto from 'crypto';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export function computeSignature(reference, amountInCents, currency) {
  return crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${config.wompi.integrityKey}`)
    .digest('hex');
}

function mapTransaction(transaction) {
  return {
    wompiTransactionId: transaction.id,
    status: transaction.status,
    amountInCents: transaction.amount_in_cents,
    redirectUrl: transaction.redirect_url || transaction.payment_method?.extra?.async_payment_url || transaction.payment_method?.extra?.url || null,
    raw: transaction,
  };
}

// Crea una transacción en Wompi para CUALQUIER método de pago (CARD, PSE, NEQUI,
// BANCOLOMBIA_TRANSFER, DAVIPLATA, ...). `paymentMethod` es el objeto { type, ... }
// que ya viene armado por el cliente (o por su tokenización previa con Wompi) — este
// backend lo reenvía casi sin tocarlo, nunca ve datos crudos de tarjeta.
//
// Wompi responde 2xx tanto para un cobro aprobado como rechazado (el resultado viaja
// en el body, no en el código HTTP) — por eso esta función solo lanza ante un fallo
// REAL de Wompi (no-2xx, red caída, body ilegible). El llamador decide qué hacer con
// cada `status` (APPROVED/DECLINED/PENDING/...).
export async function createTransaction({ reference, amountInCents, currency, customerEmail, paymentMethod }) {
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
        payment_method: paymentMethod,
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

  if (!body.data) {
    throw new HttpError(502, 'No se pudo procesar el pago con el banco. Intenta de nuevo.');
  }

  return mapTransaction(body.data);
}

export async function chargeCard({ reference, amountInCents, currency, customerEmail, cardPaymentMethod }) {
  return createTransaction({ reference, amountInCents, currency, customerEmail, paymentMethod: { type: 'CARD', ...cardPaymentMethod } });
}

// Polling para métodos async (PSE/Nequi/Bancolombia/DaviPlata): Wompi no siempre
// trae la URL de redirección en la respuesta de creación, hay que consultarla.
export async function getTransactionById(wompiTransactionId) {
  const res = await fetch(`${config.wompi.baseUrl}/transactions/${wompiTransactionId}`, {
    headers: { Authorization: `Bearer ${config.wompi.privateKey}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (!body.data) return null;
  return mapTransaction(body.data);
}

// Reverso automático: se intenta cuando el cobro fue aceptado por Wompi pero la
// persistencia local falló después (ver ordersService.checkout). Un void solo es
// válido el mismo día/antes de la conciliación bancaria — si Wompi lo rechaza, el
// llamador cae de vuelta al aviso "contacta soporte con esta referencia".
export async function voidTransaction(wompiTransactionId) {
  const res = await fetch(`${config.wompi.baseUrl}/transactions/${wompiTransactionId}/void`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.wompi.privateKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`No se pudo revertir la transacción ${wompiTransactionId}: HTTP ${res.status} ${body}`);
  }
  return true;
}

// Lista de bancos habilitados para PSE. Cambia poco durante el día, así que se
// cachea en memoria 1h — evita golpear a Wompi en cada carga del formulario de
// pago. Usa la llave pública porque es un endpoint informativo, no de cobro.
let pseBanksCache = null;
let pseBanksCachedAt = 0;
const PSE_BANKS_TTL_MS = 60 * 60 * 1000;

export async function listPseBanks() {
  const now = Date.now();
  if (pseBanksCache && now - pseBanksCachedAt < PSE_BANKS_TTL_MS) return pseBanksCache;

  let res;
  try {
    res = await fetch(`${config.wompi.baseUrl}/pse/financial_institutions`, {
      headers: { Authorization: `Bearer ${config.wompi.publicKey}` },
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', scope: 'wompi', message: err.message }));
    throw new HttpError(502, 'No se pudo obtener la lista de bancos PSE. Intenta de nuevo.');
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new HttpError(502, 'No se pudo obtener la lista de bancos PSE. Intenta de nuevo.');
  }

  if (!res.ok || !Array.isArray(body.data)) {
    throw new HttpError(502, 'No se pudo obtener la lista de bancos PSE. Intenta de nuevo.');
  }

  pseBanksCache = body.data.map((bank) => ({ code: bank.financial_institution_code, name: bank.financial_institution_name }));
  pseBanksCachedAt = now;
  return pseBanksCache;
}
