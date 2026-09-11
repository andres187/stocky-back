---
name: node-best-practices
description: Checklist of Node.js/Express backend best practices (config, validation, error handling, pooling, resilience) for writing new backend code in this project or auditing existing routes/middleware/scripts against the checklist. Use when writing, reviewing, or auditing any file in src/, or when asked to "review the backend", "audit the API", or "check Node best practices".
---

# Node.js / Express backend best practices

Use this checklist both proactively (while writing new backend code) and reactively (when asked to audit existing code). Each item explains *why* it matters.

## Checklist

1. **Secrets and config come from environment variables, never hardcoded** — DB credentials, JWT secrets, admin passwords must live in `.env` (loaded via `dotenv`) and never appear as string literals in source.
2. **`.env` is gitignored, `.env.example` documents the shape without real values** — so the repo never leaks credentials but new setups know what to configure.
3. **Every mutating endpoint validates its input before touching the database** — required fields, types, ranges, and referential validity (e.g. does the referenced category actually exist) checked explicitly, with clear error messages, not just trusted from the client.
4. **All SQL queries are parameterized, never string-concatenated** — user input must go through placeholders (`?`) so it can't be interpreted as SQL (this is the standard SQL-injection defense).
5. **Errors are handled centrally and consistently** — an Express error-handling middleware catches unhandled errors and returns a uniform shape; individual routes don't each invent their own error format.
6. **`async`/`await` handlers don't leave promise rejections unhandled** — thrown errors inside `async` route handlers must reach the error handler (Express 5's async support or explicit try/catch + `next(err)`), and there's a `process.on('unhandledRejection', ...)` safety net at the process level.
7. **Database access goes through a connection pool, not one-off connections** — `mysql2/promise`'s `createPool` reuses connections under load; ad-hoc `createConnection` calls per request don't scale and can exhaust the DB's connection limit.
8. **Multi-step writes that must succeed or fail together use a transaction** — e.g. "check a constraint, then insert/update several rows" needs `BEGIN`/`COMMIT`/`ROLLBACK` (or the pool's transaction API), or a failure partway through leaves inconsistent data.
9. **HTTP status codes match the outcome** — 200/201 for success, 400 for invalid input, 401/403 for auth failures, 404 for missing resources, 409 for conflicts, 500 only for genuinely unexpected errors.
10. **CORS is restricted to known origins in any environment that matters** — a wide-open `origin: '*'` fallback is fine for quick local dev but should not silently become the production behavior when an env var is unset.
11. **Rate limiting / request body size limits exist on public-facing endpoints**, especially authentication endpoints — without this, login endpoints are open to brute-force and the server has no defense against oversized payloads.
12. **The process handles shutdown and fatal-error signals gracefully** — `SIGTERM`/`SIGINT` handlers that close the DB pool/server cleanly, and a top-level `unhandledRejection`/`uncaughtException` handler that logs and exits rather than leaving the process in an unknown state.
13. **Logging is structured enough to debug production issues** — timestamps and enough context to trace a request; bare `console.error(err)` with no request context makes incidents hard to diagnose later.
14. **Migration/seed scripts are idempotent** — re-running them should not fail or duplicate data; use `IF NOT EXISTS`, existence checks before inserting, etc.
15. **Dependencies are kept lean and audited** — no unused packages in `package.json`, and `npm audit` is run periodically to catch known vulnerabilities in transitive dependencies.

## How to audit with this skill

When asked to audit backend code against this checklist:

1. Locate the relevant source: `src/server.js` (composition, middleware, error handler), `src/routes/*.js` (endpoints, validation), `src/middleware/*.js` (auth/cross-cutting concerns), `src/db/pool.js` (connection handling), `src/scripts/migrate.js` and `seed.js` (schema + seeding).
2. Check each checklist item against the actual code — read the files, don't guess. Use `grep`/`Grep` for cross-cutting concerns (e.g. search for `process.on(`, `BEGIN`, `createConnection`, `origin:`).
3. Produce a report, one row per checklist item, in this format:

```
### N. <short item name>
**Status:** ✅ Cumple / ⚠️ Parcial / ❌ No cumple
**Evidencia:** <file path>[:line] — what you found
**Por qué importa / riesgo:** <1-2 sentences, only if not fully compliant>
```

4. Do not silently skip items — if something isn't applicable to this project's current scale, say so explicitly rather than omitting it.
5. Do not modify code during an audit unless explicitly asked to — the audit is a report, not a refactor.
