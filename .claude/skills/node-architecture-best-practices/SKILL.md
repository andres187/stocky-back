---
name: node-architecture-best-practices
description: Checklist of Node/Express application-architecture best practices (layering, module boundaries, configuration, scalability shape) — distinct from node-best-practices, which is code-level (validation, error handling, pooling). Use when deciding where new backend logic should live, adding a new resource/route group, or when asked to "review the backend architecture" or "audit project structure".
---

# Node/Express application architecture best practices

This is about *how the API is shaped* — where logic lives and why — not individual route correctness (see `node-best-practices` for that). Use it proactively when adding something that doesn't obviously belong in an existing file, and reactively when asked to audit the project's structure.

## Checklist

1. **Module boundaries follow the domain, not accident.** One route file per resource (`products.js`, `categories.js`, `colors.js`, `sizes.js`, `auth.js`) is a reasonable, common pattern for an API this size — the check is whether it's applied *consistently*, not whether a heavier layering (controllers/services/repositories) exists yet.
2. **There's an explicit point at which "routes doing everything" should split into layers**, even if not taken yet. At small scale, a route handler doing validation + query + response shaping in one function (as this project does) is a reasonable, deliberate simplicity — not an oversight. The trigger to introduce a service/repository layer is usually: the same business logic needed from more than one route, or business logic complex enough to need its own unit tests independent of HTTP.
3. **Data access is centralized, not reinvented per route.** A single pool/client module (`db/pool.js`-style) that every route imports means connection config, pooling behavior, and (later) query logging are one place to change — not copy-pasted per file.
4. **Configuration is read from env vars in one predictable way**, ideally validated at startup (fail fast if a required var is missing) rather than discovered at request time when a feature is first used. Scattered, unchecked `process.env.X` access means a missing var surfaces as a confusing runtime error deep in a request instead of an obvious boot failure.
5. **Middleware order encodes real dependencies and is easy to audit from one file.** Security/parsing middleware (`helmet`, CORS, cookie/body parsing) before routes, routes before the 404 handler, the error handler last — `server.js` (or equivalent) should read top-to-bottom as the actual request pipeline, not require jumping across files to understand what runs when.
6. **Cross-cutting concerns (auth, rate limiting, logging) are middleware, not duplicated per route.** `requireAuth` applied per-route is fine; the check is that it's *the same* middleware everywhere, not five routes each reimplementing "check a token."
7. **The server is stateless — no in-memory session/data that would break under more than one process.** Sessions live in a signed cookie/JWT (not an in-memory `Map`), so the process can be restarted or scaled to multiple instances without losing state. This is what makes horizontal scaling and zero-downtime deploys possible later without an architecture change.
8. **Scripts (migrations, seeds) are separate from the running server**, invoked explicitly, not triggered as a side effect of the server starting — so deploying the app and changing the schema are two distinct, controllable operations.
9. **The API has a health/liveness endpoint** independent of business logic (`/api/health` here) — infrastructure (load balancers, uptime checks, container orchestrators) needs a cheap way to ask "is this process up" without exercising the database or business logic.
10. **Error handling has one funnel.** All errors — validation, unexpected exceptions, 404s — resolve through a single error-handling path with a consistent response shape, so callers (including the frontend) can handle errors generically instead of per-endpoint.
11. **There's a clear boundary for where request validation ends and business/data logic begins**, even inside a single route handler — e.g. a `validatePayload()`-style function called at the top, separate from the query logic below it — so the two concerns can be read (and later extracted) independently.
12. **New resources are added by following the existing pattern, not inventing a new one.** If every other resource is `router + validate + query`, a new resource that suddenly introduces a class-based controller or a different error-handling style fragments the codebase for no benefit — consistency beats "better" in isolation.
13. **The architecture's next scaling step is known, even if not taken.** E.g., "if a route's logic gets reused elsewhere, extract it to a service function"; "if this needs background work (emails, webhooks), that's a queue/worker, not more logic crammed into a request handler." Knowing the next lever avoids both premature abstraction and being stuck when the simple shape stops fitting.

## How to audit with this skill

When asked to audit this project's backend architecture:

1. Read `src/server.js` (composition root, middleware order, route mounting), then survey `src/routes/`, `src/middleware/`, `src/db/`, `src/scripts/` for how consistently the resource-per-file pattern (#1) and centralized data access (#3) actually hold up.
2. Note explicitly which patterns are *appropriate simplicity at this size* versus genuine gaps — e.g. no service layer is fine today; env vars read without startup validation is a real, fixable gap regardless of size.
3. Produce a report, one row per checklist item, in this format:

```
### N. <short item name>
**Status:** ✅ Cumple / ⚠️ Parcial / ❌ No cumple
**Evidencia:** <file path>[:line] — what you found
**Por qué importa / riesgo:** <1-2 sentences, only if not fully compliant>
```

4. Do not modify code during an audit unless explicitly asked to — the audit is a report, not a refactor.
