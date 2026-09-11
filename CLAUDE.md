# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the API with nodemon (auto-restart), reads `.env`
- `npm run start` — start the API with plain node
- `npm run migrate` — create the database (if missing) and tables (`src/scripts/migrate.js`)
- `npm run seed` — create the admin user and seed the product catalog, both idempotent/skip-if-exists (`src/scripts/seed.js`)

Run `migrate` then `seed` before the first `dev`/`start`. There is no test suite.

Requires a `.env` file (copy from `.env.example`): `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `CORS_ORIGIN`, `NODE_ENV`, `CUSTOMER_JWT_SECRET`, `CUSTOMER_JWT_EXPIRES_IN`, `WOMPI_BASE_URL`, `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_KEY`. `CORS_ORIGIN` must exactly match the frontend origin (no wildcard) — see Auth below, cookies with `credentials: true` don't work with `origin: '*'`. `NODE_ENV=production` is what flips the login cookie's `secure` flag on. `RESEND_API_KEY`/`RESEND_FROM_EMAIL` are optional — the order-confirmation email is best-effort and the server boots and checkout works without them (see Checkout/Payments below).

## Architecture

This is the API for **Stocky**, a women's clothing e-commerce site. It is a standalone Express + MySQL service — **fully separate from the frontend**, which lives in the sibling `../web` project (React/Vite) and only talks to this API over HTTP (`VITE_API_URL`, default `http://localhost:4000/api`). There's no shared code or monorepo tooling between the two; they're run and deployed independently.

### Request flow

`src/server.js` applies `helmet()`, `cors({ origin: CORS_ORIGIN, credentials: true })`, and `cookie-parser` before any route, then wires up seven route groups under `/api`: `authRouter`, `customerAuthRouter`, `productsRouter`, `categoriesRouter`, `colorsRouter`, `sizesRouter`, `ordersRouter`. It also owns process lifecycle: `SIGTERM`/`SIGINT` close the HTTP server and the DB pool before exiting, and `unhandledRejection`/`uncaughtException` are logged at the process level as a last-resort safety net (routes should still handle their own errors — this isn't a substitute for that).

- `authRouter` (`src/routes/auth.js`) — `POST /api/auth/login` (rate-limited: 10 requests / 15 min per IP via `express-rate-limit`) delegates credential checking to `services/authService.js`, then sets the returned JWT as an `httpOnly` cookie (`stocky_admin_token`) — **the token is never returned in the JSON response body**. `POST /api/auth/logout` clears that cookie. `GET /api/auth/me` (protected) is how the frontend checks "is there a valid session?" on load, since JS can't read an `httpOnly` cookie directly.
- `productsRouter`/`categoriesRouter`/`colorsRouter`/`sizesRouter` — public reads, `requireAuth`-gated writes (see below).

`src/middleware/auth.js` (`requireAuth`) reads the JWT from the `stocky_admin_token` cookie (`req.cookies`, populated by `cookie-parser`) — **not** an `Authorization` header — verifies it with `JWT_SECRET`, and attaches the decoded payload to `req.admin`. There is only one admin role — no permission levels. Because auth is cookie-based, any client calling this API (including the frontend's `apiFetch`) must send requests with credentials/cookies included, or `requireAuth` will always 401.

### Customer auth (separate from admin auth)

Checkout requires a customer account — a second, parallel auth system to the admin one above, not an extension of it:

- `customerAuthRouter` (`src/routes/customerAuth.js`) — `POST /api/customer-auth/register`, `POST /api/customer-auth/login` (both rate-limited, 10/15min), `POST /api/customer-auth/logout`, `GET /api/customer-auth/me` (protected). Sets/clears an `httpOnly` cookie `stocky_customer_token` — never returned in the JSON body, same as the admin cookie.
- `src/middleware/customerAuth.js` (`requireCustomerAuth`) — reads `stocky_customer_token`, verifies with `CUSTOMER_JWT_SECRET` (a **separate** secret from admin's `JWT_SECRET` — deliberately, so a bug mixing up the two cookies fails closed instead of silently cross-verifying), attaches `req.customer = { sub, email }`.
- `src/services/customerAuthService.js` — `bcrypt.hash(password, 12)`, generic "Correo o contraseña incorrectos." error whether the email doesn't exist or the password is wrong (anti-enumeration, same pattern as admin `authService.login`).

### Checkout / Payments (Wompi)

`POST /api/orders/checkout` (`requireCustomerAuth`, rate-limited 20/15min) is the only way an order gets created — there is no admin "create order" endpoint. Card-only in this version (`paymentMethod.type === 'CARD'`); the payload shape is generic so PSE/Nequi/Bancolombia/DaviPlata can be added later without a rewrite.

Flow (`src/services/ordersService.js` + `src/services/paymentService.js`):
1. `buildOrderFromLines` re-prices every line from the current `products` table (never trusts a client-sent subtotal/total) and pre-checks `variant_stock` for each `{color,size}` — optimistic, re-checked again in step 4.
2. The request's `amountInCents` must exactly equal the server-computed `total * 100` (COP has no minor unit, so this is an exact match, not a rounding window) — mismatch is a 409, and Wompi is never called.
3. `paymentService.chargeCard(...)` calls Wompi **before any DB write**. Wompi returns 2xx for both an **approved** and a **declined** card — the outcome travels in the response body's `status` field, not the HTTP status code — so `chargeCard` only throws on a genuine Wompi-side failure (non-2xx, network error, unparseable body); a decline is a normal, non-throwing result. The Wompi integrity `signature` is computed server-side (`SHA-256(reference+amountInCents+currency+WOMPI_INTEGRITY_KEY)`), and the request carries an `Idempotency-Key` equal to the server-generated `reference`.
4. **As long as Wompi accepted the request at all**, the order is persisted — approved or declined — matching `etniapp-core`'s actual behavior (`PersistCheckout` there never inspects the transaction status before writing). One `pool.getConnection()` transaction: re-check stock with `SELECT ... FOR UPDATE`, insert `orders` (`status = 'paid'` if Wompi's status was `APPROVED`, else `'failed'`), insert `order_items`, decrement `products.variant_stock`, insert one `shipments` row (`status='pending'`), insert `payment_transactions` with Wompi's raw status. Stock is decremented and a shipment is created even on a declined card, same as the reference — a declined order still exists as a real row for back-office reconciliation; it's on `orders.status`/`payment_transactions.status`, not on the row's existence, that a caller tells approved apart from declined. If this transaction fails **after** Wompi already responded (e.g. a lost stock race), there is no automatic Wompi reversal — it's logged at `fatal-payment-orphan` with the Wompi transaction id and returned to the client as a 500 telling them to contact support with that id for a manual refund (this part of the gap is carried over from the reference deliberately, not invented).
5. A real double-submit guard: the client sends its own `idempotencyKey` (generated once, e.g. when the payment form mounts); `orders` has `UNIQUE (customer_id, idempotency_key)`, and a repeated request with the same key returns the existing order without charging Wompi again — the server-generated `reference` alone does *not* protect against this, since a fresh HTTP retry would otherwise get a fresh reference.
6. After commit, `emailService.sendOrderConfirmation(...)` (Resend) runs best-effort, and **only when Wompi approved** — a deliberate deviation from the reference, which emails "confirmed" regardless of status; doing that here would mislead a customer whose card was actually declined. A send failure is logged in its own `try/catch` and never changes the 201 response or rolls back the already-persisted order.

`GET /api/orders` / `GET /api/orders/:id` return only the authenticated customer's own orders (404 on any order id that isn't theirs).

### Service layer

Business logic (validation, queries, serialization) lives in `src/services/*.js`, one file per resource (`productsService`, `categoriesService`, `colorsService`, `sizesService`, `authService`) — routes are a thin HTTP layer that parse `req`, call a service function, and shape the response. Services never touch `req`/`res`; they take plain arguments and either return data or `throw new HttpError(status, body)` (`src/services/errors.js`). Route handlers have **no try/catch** — Express 5 forwards a rejected async handler to the global error middleware automatically, which checks `err instanceof HttpError` first (status/body used as-is) before falling through to the generic sanitized 500 (see below). When adding a new resource, follow this same shape rather than putting logic directly in the route.

### Products API and filtering

- `GET /api/products?categoria=` — public, `active = 1` only. `categoria` is interpreted in `productsService.listPublic()`: `nuevo` → `badge = 'new'`, `ofertas` → `old_price IS NOT NULL`, anything else → exact `category` match, `todo`/omitted → all.
- `GET /api/products/admin` — protected, returns the full catalog including inactive products (used by the admin dashboard table).
- `GET /api/products/:id`, `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id` — standard CRUD; POST/PUT/DELETE require `requireAuth` and `productsService`'s internal `validatePayload()` (name, cat exists in `categories`, price > 0, oldPrice > price if set, img, badge in `['new','low']`, non-empty colors/sizes arrays, bestsellerOrder is a positive int if set, each `variantStock` entry has a non-negative int `stock`) — throws `HttpError(400, { errors: [...] })` on failure. The category-exists check here is a friendlier pre-check; the FK constraint (see Data model) is the actual guarantee.
- Route order matters in `products.js`: `/admin` is declared before `/:id` so it isn't swallowed by the id param route.

### Data model

Eleven tables (created by `migrate.js`, no ORM/migration framework — raw SQL, idempotent via `IF NOT EXISTS` / guarded `ALTER TABLE`):
- `admins(id, username, password_hash, created_at)`
- `products(id, name, category, description, price, old_price, image_url, badge ENUM('new','low'), colors JSON, sizes JSON, active, bestseller_order, variant_stock JSON, created_at, updated_at)`
- `categories(id, slug UNIQUE, label, sort_order, created_at)` — `products.category` has a `FOREIGN KEY ... REFERENCES categories(slug) ON DELETE RESTRICT`, so deleting a category that's in use fails atomically at the DB level (`categoriesRouter`'s DELETE route catches `ER_ROW_IS_REFERENCED_2`/errno 1451 and turns it into a 409 — there's no app-level "count then delete" check anymore, that pattern was a TOCTOU race).
- `colors(id, name UNIQUE, hex, created_at)`, `sizes(id, label UNIQUE, sort_order, created_at)` — these are the *available options* offered in the admin UI, not referenced by FK from `products`.
- `products.active` has a plain index (`idx_products_active`) since every storefront read filters on it.
- `customers(id, email UNIQUE, password_hash, full_name, phone, created_at)` — separate from `admins`, see Customer auth above.
- `orders(id, customer_id FK→customers RESTRICT, reference UNIQUE, idempotency_key, status ENUM('pending','paid','failed'), subtotal, shipping_cost, total, shipping_name/email/phone/address/city, notes, created_at, updated_at)`, with `UNIQUE (customer_id, idempotency_key)`. Money columns are plain `INT` (COP has no minor unit) — never `FLOAT`.
- `order_items(id, order_id FK→orders CASCADE, product_id FK→products RESTRICT, product_name, color, size, quantity, unit_price)` — `product_name`/`unit_price` are snapshots at purchase time, same denormalization reasoning as `products.colors`/`products.sizes` below.
- `shipments(id, order_id UNIQUE FK→orders CASCADE, status ENUM('pending','shipped','delivered'), tracking_number, created_at, updated_at)` — one row per paid order (Stocky has no multi-store/service split, unlike the reference implementation this was adapted from). No status-mutation endpoint exists yet; a future admin `PATCH` would be additive, no schema change.
- `payment_transactions(id, order_id UNIQUE FK→orders RESTRICT, wompi_transaction_id UNIQUE, status, amount_in_cents, currency, payment_method_type, raw_response JSON, created_at)` — `status` is a raw `VARCHAR` mirroring Wompi's own status strings (not an `ENUM`), so a future webhook can update it without a migration.

`products.colors`/`products.sizes` (`[{ name, hex }]` / `[string]`) are each product's own snapshot of which options it offers, and `variant_stock` (`[{ color, size, stock }]`) is optional per-combination inventory — none of these three JSON columns have a FK back to `colors`/`sizes`; that's a deliberate denormalization (a product's color/size list is captured at edit time, not live-joined), not an oversight. `bestseller_order` (nullable int, 1-3) drives which products show in the storefront hero carousel. `services/productsService.js`'s `serialize()` is the single place that maps DB snake_case rows (`category`, `old_price`, `image_url`, `bestseller_order`, `variant_stock`) to the camelCase API shape (`cat`, `oldPrice`, `img`, `bestsellerOrder`, `variantStock`) the frontend expects — keep both in sync when changing either side.

### Seeding

`src/scripts/seed.js` is safe to re-run: it checks `admins` for the configured `ADMIN_USERNAME` and `products` for any row before inserting, so it never duplicates data. The seeded catalog (15 products) mirrors what used to be hardcoded in the frontend before it was migrated to fetch from this API. It also seeds one throwaway test customer (`cliente.prueba@stocky.test` / `prueba1234`) for exercising the checkout flow manually — note seeded products don't get a `variant_stock` value, so set one on a product before testing checkout against it (there's no stock to decrement otherwise).
