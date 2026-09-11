---
name: web-payments-best-practices
description: Checklist of best practices for integrating a real web payment/checkout flow (PCI scope, tokenization, server-side amount verification, idempotency, webhooks, refunds) — for building Stocky's real checkout against a payment provider, or auditing an existing payment integration. Use when writing or changing anything related to checkout, payments, orders, or a payment provider SDK/webhook, or when asked to "review payments" or "audit checkout security".
---

# Web payments best practices

Stocky's current `Checkout.jsx` is a client-only mock (fake order number, no real charge, no backend call). This skill applies once that becomes a real payment integration. Use it both proactively (while building the real flow) and reactively (auditing it once it exists). Each item explains *why* it matters. This is provider-agnostic (Stripe, Wompi, PayU, MercadoPago, ePayco — common choices for a Colombian storefront like this one — all share these fundamentals).

## Checklist

1. **Never let raw card data touch your own server or frontend code.** Use the provider's hosted fields, drop-in widget, or redirect/checkout-session flow so card numbers go straight from the customer's browser to the provider. This is what keeps you in the smallest PCI-DSS compliance scope (SAQ-A) instead of the much heavier one that applies if your code ever sees a raw PAN.
2. **The amount charged is computed and verified server-side, never trusted from the client.** The frontend can *display* a total, but the backend must recompute subtotal/shipping/total from the actual product prices and stock at charge time — a tampered client request should not be able to pay less than the real price.
3. **Payment intents/sessions are created server-side, keyed to a specific order.** The client asks the backend "create a checkout for this cart," the backend talks to the provider with its secret key and returns only what the client needs (a session id / client secret) — the provider's secret API key never reaches the browser.
4. **Idempotency keys on payment-creation requests.** A retried request (network blip, double-click, browser back button) must not create two charges for the same order — pass an idempotency key (most providers support this natively) derived from the order id.
5. **Webhooks are verified by signature, not trusted on content alone.** The provider sends a signature header computed with a shared secret; the backend must verify it before trusting a "payment succeeded" webhook payload — otherwise anyone can POST a fake "paid" event to your endpoint.
6. **Order state is only finalized from the webhook/confirmed callback, not from the client-side "success" redirect.** A user can close the tab or lose connection right after paying but before the redirect fires; the webhook is the source of truth for "did this actually get paid."
7. **Stock is decremented atomically and only on confirmed payment**, inside a transaction, checking availability again at that moment — not when the item was added to the cart. (Stocky already has per-variant `variant_stock`; when checkout becomes real, the decrement belongs here, guarded by a transaction — see the `database-best-practices` skill.)
8. **Test/sandbox and live keys are kept in separate env vars and never mixed.** A live secret key committed or used in a dev environment is a real financial risk, not just a bug.
9. **Amounts are stored and compared in the smallest currency unit or with explicit precision handling.** For COP (no minor unit in practice, but still): keep the app consistent about integers vs. decimals end-to-end (frontend display, backend calculation, provider API) — silent float rounding is a classic source of off-by-one-peso mismatches that break idempotent comparisons.
10. **Sensitive payment details are never logged.** Log the order id, provider transaction id, and status — not full card metadata, CVV, or full webhook payloads containing customer payment details.
11. **Failed/declined payments have a clear, distinguishable state from "pending" and "succeeded."** The UI and the order record should be able to tell a customer "your card was declined, try again" versus "we're still waiting to hear back from the bank," which are different situations requiring different messaging.
12. **Refunds/cancellations go through the provider's API, not just an internal status flag.** Marking an order "refunded" in your own DB without actually calling the provider's refund endpoint leaves the customer's money uncharged-back — the internal state should reflect what actually happened at the provider.
13. **Rate limiting / abuse protection on checkout-initiation endpoints**, same reasoning as the login-security skill — an unthrottled "create payment session" endpoint can be used to probe stolen card numbers (card testing fraud) at your expense.
14. **HTTPS is enforced end-to-end in any real deployment** — payment redirects, webhooks, and the checkout page itself must never be served over plain HTTP.

## How to audit with this skill

When asked to audit a payment/checkout integration against this checklist:

1. Locate the relevant code: the checkout page/component, any `routes/orders.js` or `routes/payments.js`-style backend route, webhook handler, and wherever stock gets decremented.
2. Check each checklist item against the actual code — read the files, don't guess. Grep for the provider's secret key variable name to confirm it's never referenced from frontend code; grep for webhook signature verification calls.
3. Produce a report, one row per checklist item, in this format:

```
### N. <short item name>
**Status:** ✅ Cumple / ⚠️ Parcial / ❌ No cumple
**Evidencia:** <file path>[:line] — what you found
**Por qué importa / riesgo:** <1-2 sentences, only if not fully compliant>
```

4. If checkout is still the client-only mock (no real provider integrated yet), say so explicitly as the overall status rather than marking individual items — most of this checklist is N/A until a real provider is wired in.
5. Do not modify code during an audit unless explicitly asked to — the audit is a report, not a fix.
