# Cleanups batch — tasks

> Companion to `specs.md`. One worktree (`feat/cleanups-batch`). Two independent one-touch WPs. Effort:
> Very Low each.

- **WP1 — C-1 unify session_id validator.** Effort: Very Low. Level: API.
  - `apis/fastapi/sessions/router.py:105`: change `_SESSION_ID_RE` to `^[a-zA-Z0-9_\-]{1,128}$` (drop `.`,
    cap 128) — match the streams contract (`dbs/redis/sessions/contract.py:99`).
  - Confirm the 3 wrapper call sites still pass. Add/adjust a test if one asserts the old shape.

- **WP2 — C-2 fix `actionable_only`.** Effort: Very Low. Level: API.
  - `dbs/postgres/sessions/interactions/dao.py`: add the `status == 'pending'` predicate; bind the
    interval as a parameter (remove the f-string TTL and the inline `text` import if now unused).
  - Test: `actionable_only=true` returns only pending-in-window; a pending-but-old and a non-pending-in-window
    are both excluded.

## Verify
- API: `ruff format` then `ruff check --fix` from `api/`; `cd api && py-run-tests` for the interactions +
  sessions router tests.
- Report real results; do NOT commit; do NOT deploy the stack.

## Constraints
- Layering rule applies to new domain code, not legacy routers.
- One terse comment line max, or none.
