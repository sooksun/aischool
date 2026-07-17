# Cleanup H1 — atomic AI suggest mappings

Branch: `feat/cleanup-H1-suggest-atomic` · Date: 2026-07-18

## Problem
`suggestMappingsLocalHeuristic` created mappings + outbox events one-by-one outside a
transaction, and `catch { skippedActive++ }` swallowed every error (including non-P2002).

## Fix
1. **Rank** indicators outside the write path (read-only).
2. **Single `$transaction`**: re-read active mappings, insert suggestions + per-row
   `evidence.mapping.suggested` outbox + batch `ai.suggestion.created` — all commit or
   none do.
3. **No catch-and-continue inside the tx** (PostgreSQL aborts after P2002). Concurrent
   unique races retry the whole write once with a fresh active set; other errors propagate.
4. `createMapping` / `listActiveMappedIndicatorIds` accept optional `tx` client.

## Behavior preserved
- Still sync local_heuristic API; still returns `{ items, skipped_active }`.
- Still never auto-confirms; still `mapping_source=ai_suggested`.

## Verify
```
npm run build --workspace packages/database
npm run build --workspace apps/api
node --env-file-if-exists=.env --test apps/api/test/reports-and-ai.test.mjs
```
