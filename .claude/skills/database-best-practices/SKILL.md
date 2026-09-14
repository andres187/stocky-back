---
name: database-best-practices
description: Checklist of relational database / SQL schema design best practices (referential integrity, indexes, transactions, data types) for designing new tables/migrations in this project or auditing the existing MySQL schema against the checklist. Use when writing or changing anything in src/scripts/migrate.js, writing new queries, or when asked to "review the database schema" or "audit the data model".
---

# Relational database / SQL best practices

Use this checklist both proactively (while designing new tables or queries) and reactively (when asked to audit the existing schema). Each item explains *why* it matters, and notes where a deliberate denormalization trade-off is acceptable rather than a bug.

**Before starting:** update your branch against `main`/`origin` (fetch + rebase or merge) so you're working from the latest changes, not a stale checkout — do this again before opening a PR.

## Checklist

1. **Referential integrity is enforced, ideally at the database level** — a column that logically references another table's row (a category slug, a color name) should either be a real `FOREIGN KEY`, or — if intentionally denormalized (e.g. a JSON snapshot for flexibility/history) — that trade-off should be documented, not accidental.
2. **Every column referenced in a `WHERE`/`JOIN`/`ORDER BY` on a table expected to grow has an index** — without one, queries degrade from O(log n) to full table scans as data grows.
3. **Uniqueness constraints exist wherever the domain requires uniqueness** — `UNIQUE` on natural keys (slugs, usernames, names used as lookups) prevents duplicate/inconsistent data that application-level checks alone can race past.
4. **Multi-step writes that must be atomic use a transaction** — "check a condition (e.g. no rows reference this one), then delete" is a classic TOCTOU race if not wrapped in a transaction (or enforced via `FOREIGN KEY ... ON DELETE RESTRICT` instead of an application-level count-then-delete).
5. **Data types match the domain** — money/quantities as integers or fixed-point (avoid `FLOAT` for currency), booleans as `TINYINT(1)` or a real boolean type, enumerated small sets as `ENUM` or a lookup table, free-form structured data as `JSON` only when it's genuinely variable-shape.
6. **Every table has audit timestamps** — `created_at` (and `updated_at` where rows are mutated) make debugging and support possible without extra tooling.
7. **Deletes that could orphan or corrupt related data are guarded** — either DB-level (`ON DELETE RESTRICT`/`CASCADE` chosen deliberately) or application-level with a check that can't race (see #4).
8. **Migrations are idempotent and re-runnable** — `CREATE TABLE IF NOT EXISTS`, guarded `ALTER TABLE ... ADD COLUMN` (catching "column already exists"), so the same script can run safely against a fresh DB or an existing one.
9. **Connections are pooled, not opened per-query** — a connection pool amortizes connection setup cost and caps concurrent DB load (this overlaps with the Node.js best-practices skill).
10. **Sensitive data is never stored in plaintext** — passwords hashed (bcrypt/argon2), not reversibly encrypted or, worse, plain text (overlaps with the login-security skill).
11. **JSON columns are a deliberate choice, not a default** — fine for genuinely schemaless/variable data (e.g. a product's available color+size combinations, which vary per row), but if the app frequently needs to query *inside* the JSON (filter/join on a value nested in it), that's a sign it should be a normalized table instead.
12. **Character set/collation support the data** — `utf8mb4` (not legacy `utf8`) for any text that might contain accented characters, emoji, or non-Latin scripts.
13. **Row-level checks that matter for correctness aren't silently skippable** — e.g. price fields with a `> 0` invariant should be validated (app-level here, since MySQL `CHECK` constraint support/enforcement varies by version) and that invariant should be enforced on every write path, not just the form UI.

## How to audit with this skill

When asked to audit the schema against this checklist:

1. Read `src/scripts/migrate.js` for the full schema (tables, columns, types, keys, indexes) and `src/scripts/seed.js` for how data is populated.
2. Grep `src/routes/*.js` for how the schema is actually queried/mutated — look for multi-step read-then-write sequences (candidates for #4), and for any JSON column being filtered/searched inside (candidate for #11).
3. Produce a report, one row per checklist item, in this format:

```
### N. <short item name>
**Status:** ✅ Cumple / ⚠️ Parcial / ❌ No cumple
**Evidencia:** <file path>[:line] — what you found
**Por qué importa / riesgo:** <1-2 sentences, only if not fully compliant>
```

4. When something looks like a violation but is actually a deliberate, documented trade-off (check the project's `CLAUDE.md` first), say so explicitly — don't flag intentional design as a defect without that context.
5. Do not modify the schema or write migrations during an audit unless explicitly asked to — the audit is a report, not a refactor.
