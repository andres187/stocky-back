# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the API with nodemon (auto-restart), reads `.env`
- `npm run start` — start the API with plain node
- `npm run migrate` — create the database (if missing) and tables (`src/scripts/migrate.js`)
- `npm run seed` — create the admin user and seed the product catalog, both idempotent/skip-if-exists (`src/scripts/seed.js`)

Run `migrate` then `seed` before the first `dev`/`start`. There is no test suite.

Requires a `.env` file (copy from `.env.example`): `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `CORS_ORIGIN`, `NODE_ENV`. `CORS_ORIGIN` must exactly match the frontend origin (no wildcard) — see Auth below, cookies with `credentials: true` don't work with `origin: '*'`. `NODE_ENV=production` is what flips the login cookie's `secure` flag on.

## Architecture

This is the API for **Stocky**, a women's clothing e-commerce site. It is a standalone Express + MySQL service — **fully separate from the frontend**, which lives in the sibling `../web` project (React/Vite) and only talks to this API over HTTP (`VITE_API_URL`, default `http://localhost:4000/api`). There's no shared code or monorepo tooling between the two; they're run and deployed independently.

### Request flow

`src/server.js` applies `helmet()`, `cors({ origin: CORS_ORIGIN, credentials: true })`, and `cookie-parser` before any route, then wires up five route groups under `/api`: `authRouter`, `productsRouter`, `categoriesRouter`, `colorsRouter`, `sizesRouter`. It also owns process lifecycle: `SIGTERM`/`SIGINT` close the HTTP server and the DB pool before exiting, and `unhandledRejection`/`uncaughtException` are logged at the process level as a last-resort safety net (routes should still handle their own errors — this isn't a substitute for that).

- `authRouter` (`src/routes/auth.js`) — `POST /api/auth/login` (rate-limited: 10 requests / 15 min per IP via `express-rate-limit`) delegates credential checking to `services/authService.js`, then sets the returned JWT as an `httpOnly` cookie (`stocky_admin_token`) — **the token is never returned in the JSON response body**. `POST /api/auth/logout` clears that cookie. `GET /api/auth/me` (protected) is how the frontend checks "is there a valid session?" on load, since JS can't read an `httpOnly` cookie directly.
- `productsRouter`/`categoriesRouter`/`colorsRouter`/`sizesRouter` — public reads, `requireAuth`-gated writes (see below).

`src/middleware/auth.js` (`requireAuth`) reads the JWT from the `stocky_admin_token` cookie (`req.cookies`, populated by `cookie-parser`) — **not** an `Authorization` header — verifies it with `JWT_SECRET`, and attaches the decoded payload to `req.admin`. There is only one admin role — no permission levels. Because auth is cookie-based, any client calling this API (including the frontend's `apiFetch`) must send requests with credentials/cookies included, or `requireAuth` will always 401.

### Service layer

Business logic (validation, queries, serialization) lives in `src/services/*.js`, one file per resource (`productsService`, `categoriesService`, `colorsService`, `sizesService`, `authService`) — routes are a thin HTTP layer that parse `req`, call a service function, and shape the response. Services never touch `req`/`res`; they take plain arguments and either return data or `throw new HttpError(status, body)` (`src/services/errors.js`). Route handlers have **no try/catch** — Express 5 forwards a rejected async handler to the global error middleware automatically, which checks `err instanceof HttpError` first (status/body used as-is) before falling through to the generic sanitized 500 (see below). When adding a new resource, follow this same shape rather than putting logic directly in the route.

### Products API and filtering

- `GET /api/products?categoria=` — public, `active = 1` only. `categoria` is interpreted in `productsService.listPublic()`: `nuevo` → `badge = 'new'`, `ofertas` → `old_price IS NOT NULL`, anything else → exact `category` match, `todo`/omitted → all.
- `GET /api/products/admin` — protected, returns the full catalog including inactive products (used by the admin dashboard table).
- `GET /api/products/:id`, `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id` — standard CRUD; POST/PUT/DELETE require `requireAuth` and `productsService`'s internal `validatePayload()` (name, cat exists in `categories`, price > 0, oldPrice > price if set, img, badge in `['new','low']`, non-empty colors/sizes arrays, bestsellerOrder is a positive int if set, each `variantStock` entry has a non-negative int `stock`) — throws `HttpError(400, { errors: [...] })` on failure. The category-exists check here is a friendlier pre-check; the FK constraint (see Data model) is the actual guarantee.
- Route order matters in `products.js`: `/admin` is declared before `/:id` so it isn't swallowed by the id param route.

### Data model

Six tables (created by `migrate.js`, no ORM/migration framework — raw SQL, idempotent via `IF NOT EXISTS` / guarded `ALTER TABLE`):
- `admins(id, username, password_hash, created_at)`
- `products(id, name, category, description, price, old_price, image_url, badge ENUM('new','low'), colors JSON, sizes JSON, active, bestseller_order, variant_stock JSON, created_at, updated_at)`
- `categories(id, slug UNIQUE, label, sort_order, created_at)` — `products.category` has a `FOREIGN KEY ... REFERENCES categories(slug) ON DELETE RESTRICT`, so deleting a category that's in use fails atomically at the DB level (`categoriesRouter`'s DELETE route catches `ER_ROW_IS_REFERENCED_2`/errno 1451 and turns it into a 409 — there's no app-level "count then delete" check anymore, that pattern was a TOCTOU race).
- `colors(id, name UNIQUE, hex, created_at)`, `sizes(id, label UNIQUE, sort_order, created_at)` — these are the *available options* offered in the admin UI, not referenced by FK from `products`.
- `products.active` has a plain index (`idx_products_active`) since every storefront read filters on it.

`products.colors`/`products.sizes` (`[{ name, hex }]` / `[string]`) are each product's own snapshot of which options it offers, and `variant_stock` (`[{ color, size, stock }]`) is optional per-combination inventory — none of these three JSON columns have a FK back to `colors`/`sizes`; that's a deliberate denormalization (a product's color/size list is captured at edit time, not live-joined), not an oversight. `bestseller_order` (nullable int, 1-3) drives which products show in the storefront hero carousel. `services/productsService.js`'s `serialize()` is the single place that maps DB snake_case rows (`category`, `old_price`, `image_url`, `bestseller_order`, `variant_stock`) to the camelCase API shape (`cat`, `oldPrice`, `img`, `bestsellerOrder`, `variantStock`) the frontend expects — keep both in sync when changing either side.

### Seeding

`src/scripts/seed.js` is safe to re-run: it checks `admins` for the configured `ADMIN_USERNAME` and `products` for any row before inserting, so it never duplicates data. The seeded catalog (15 products) mirrors what used to be hardcoded in the frontend before it was migrated to fetch from this API.
