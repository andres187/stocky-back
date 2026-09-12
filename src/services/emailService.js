import { config } from '../config.js';

const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

function renderHtml({ fullName, reference, items, subtotal, shippingCost, total }) {
  const rows = items
    .map((it) => `<tr><td>${it.productName} (${it.color}, ${it.size}) x${it.quantity}</td><td>${fmt.format(it.unitPrice * it.quantity)}</td></tr>`)
    .join('');
  return `
    <p>Hola ${fullName}, tu pedido <b>${reference}</b> fue confirmado.</p>
    <table>${rows}</table>
    <p>Subtotal: ${fmt.format(subtotal)}<br/>Envío: ${fmt.format(shippingCost)}<br/><b>Total: ${fmt.format(total)}</b></p>
  `;
}

// Best-effort: el llamador (ordersService.checkout) envuelve esto en su propio
// try/catch. Un fallo aquí nunca debe revertir ni bloquear un checkout ya pagado.
export async function sendOrderConfirmation({ to, fullName, reference, items, subtotal, shippingCost, total }) {
  if (!config.resend.apiKey || !config.resend.fromEmail) {
    console.warn(JSON.stringify({ level: 'warn', scope: 'email', reference, message: 'RESEND_API_KEY/RESEND_FROM_EMAIL no configurados, correo omitido.' }));
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resend.fromEmail,
      to,
      subject: `Pedido ${reference} confirmado`,
      html: renderHtml({ fullName, reference, items, subtotal, shippingCost, total }),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status}`);
  }
}

// Código OTP de inicio de sesión / registro. Al revés que el correo de pedido,
// este NO es best-effort: si no sale, el usuario espera un código que nunca va a
// llegar, así que se lanza y otpService deja que el error suba al cliente.
export async function sendOtpCode({ to, code, expiresMinutes }) {
  if (!config.resend.apiKey || !config.resend.fromEmail) {
    if (config.nodeEnv === 'production') {
      throw new Error('RESEND_API_KEY/RESEND_FROM_EMAIL no configurados: no se puede enviar el código.');
    }
    // En desarrollo se imprime en el log para poder probar el flujo sin Resend.
    console.warn(JSON.stringify({ level: 'warn', scope: 'otp-email', to, code, message: 'Resend no configurado, código impreso en el log.' }));
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.resend.fromEmail,
      to,
      subject: 'Tu código de acceso a Stocky',
      html: `<p>Tu código de acceso es <b style="font-size:22px;letter-spacing:3px">${code}</b>.</p><p>Vence en ${expiresMinutes} minutos. Si no lo pediste, ignora este correo.</p>`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend respondió ${res.status}`);
  }
}
