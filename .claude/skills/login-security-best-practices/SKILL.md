---
name: login-security-best-practices
description: Checklist of login/authentication security best practices (password hashing, token handling, brute-force protection, CORS, session invalidation) for building new auth flows or auditing an existing login system (frontend or backend) against the checklist. Use when writing or changing anything related to auth/JWT/login/session, or when asked to "review security", "audit login", or "check auth best practices". Complements (does not replace) the installed claude-security skill, which is a scan-and-patch workflow rather than a best-practices reference.
---

# Login / authentication security best practices

Use this checklist both proactively (while building or changing auth flows) and reactively (when asked to audit an existing login system). This applies on both sides of an app: the frontend that holds and sends a token, and the backend that issues and verifies it. Each item explains *why* it matters.

**Before starting:** update your branch against `main`/`origin` (fetch + rebase or merge) so you're working from the latest changes, not a stale checkout — do this again before opening a PR.

## Checklist

1. **Passwords are hashed with a slow, salted algorithm** — bcrypt (cost ≥ 10, 12 is a more current default) or argon2, never a fast hash (MD5/SHA-1/SHA-256 alone) and never reversible encryption or plaintext.
2. **The JWT/session secret is a strong random value, kept only in server-side env config** — never hardcoded, never committed, never reused across environments.
3. **Tokens have an expiration** — a JWT without `exp` (or an excessively long one) stays valid forever if leaked; short-to-moderate expiry limits the blast radius of a stolen token.
4. **Token payloads carry no sensitive data** — a JWT is base64-encoded, not encrypted; anyone holding it can read the payload. It should contain only an identifier and non-sensitive claims, never a password, full PII, or secrets.
5. **Where the token is stored on the client matters** — `localStorage`/`sessionStorage` are readable by any JS running on the page, so an XSS bug anywhere becomes a full account takeover; an `httpOnly` cookie (ideally with `Secure`+`SameSite`) isn't readable by JS, which meaningfully raises the bar. This is a real trade-off (cookies bring their own CSRF considerations), not a default to skip evaluating.
5b. **If tokens are stored in a way JS can read, XSS defenses elsewhere become load-bearing for auth** — e.g. no `dangerouslySetInnerHTML` with unsanitized content anywhere in the app.
6. **Login endpoints are rate-limited / throttled** — without a limit on attempts per IP or per account, credentials are brute-forceable; a missing rate limiter on `/login`-type endpoints is a real, common gap.
7. **Login failure messages are generic** — "usuario o contraseña incorrectos" for both "user doesn't exist" and "wrong password"; a message that reveals which one leaks whether an account exists (user enumeration).
8. **CORS is restricted to known origins for any endpoint that accepts credentials/tokens** — a wildcard (`*`) origin, especially combined with credentials, defeats the purpose of same-origin protections. A code fallback of `*` when an env var is unset is a latent risk even if the configured value is correct.
9. **Every mutating/privileged route is actually protected, consistently** — an auth-required middleware applied to *some* routes but forgotten on a newly added one is a common way privilege checks silently regress; this needs to be verified route-by-route, not assumed from one example.
10. **Secrets never reach version control** — `.env` (or equivalent) is gitignored, and only an `.env.example` with placeholder values is committed.
11. **Logout has a clear, understood scope** — client-side-only logout (clearing a stored token) does not revoke a still-valid JWT; if that's the design, it should be a deliberate, short-expiry trade-off, not an assumed "the user is logged out" guarantee. True revocation needs server-side state (a blacklist, a token version/generation field, or short-lived tokens + refresh).
12. **Security-relevant HTTP headers are set** — at minimum via something like `helmet` (sensible defaults for `X-Content-Type-Options`, `X-Frame-Options`/frame-ancestors, etc.); their absence is a low-effort, commonly-flagged gap.
13. **Input reaching auth logic is validated before use** — empty/malformed username or password should be rejected with a 400 before touching the database, not passed through to a query.
14. **Dependencies involved in auth (jwt libraries, bcrypt, etc.) are kept current** — known CVEs in auth-adjacent packages are higher severity than in unrelated ones; `npm audit` should be checked periodically.

## How to audit with this skill

When asked to audit login/auth security against this checklist:

1. On the frontend, look at the auth context/provider (state + login/logout functions) and the HTTP client wrapper that attaches the token to requests.
2. On the backend, look at the auth route (login endpoint, password verification, token issuance), the auth middleware (token verification, what it protects), and every route file to confirm the middleware is applied consistently — don't just check one route and assume the rest match.
3. Check the env config template (`.env.example`) for how secrets are meant to be supplied, and confirm the real `.env` is gitignored.
4. Produce a report, one row per checklist item, in this format:

```
### N. <short item name>
**Status:** ✅ Cumple / ⚠️ Parcial / ❌ No cumple
**Evidencia:** <file path>[:line] — what you found
**Por qué importa / riesgo:** <1-2 sentences, only if not fully compliant>
```

5. When a gap is a deliberate, reasonable trade-off for the project's current stage (e.g. a single hardcoded admin user with no self-service registration), say so explicitly rather than treating every gap as equally urgent.
6. Do not modify code during an audit unless explicitly asked to — the audit is a report, not a fix.
