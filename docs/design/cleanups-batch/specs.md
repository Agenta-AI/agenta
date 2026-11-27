# Cleanups batch — specs

> The Very-Low-effort consistency/soundness cleanups from the v3 assessment (C-1, C-2). Source:
> `big-agents-audit/big-agents-assessment-v3.md`. Trivial, self-contained; batched into one small PR so
> they don't pad the security/scalability diffs. (C-3 — duplicate `allow_insecure` — is folded into the
> security worktree's SEC-1, not here.)

## C-1 — Unify the session_id validator (Very Low)

**Problem.** Two divergent patterns:
- streams contract: `^[a-zA-Z0-9_\-]{1,128}$` (`api/oss/src/dbs/redis/sessions/contract.py:99`)
- router: `^[\w.\-]{1,256}$` (`api/oss/src/apis/fastapi/sessions/router.py:105`)

**Fix.** Unify to **128** and the stricter charset — drop the `.`, cap at 128 — at `router.py:105`. The 3
call sites already go through the wrapper, so it is a one-line change.

**Done when:** both surfaces accept the same session_id shape (`^[a-zA-Z0-9_\-]{1,128}$`); the 3 call
sites still pass their existing tests.

## C-2 — `actionable_only` filter is partially inert (Very Low)

**Problem.** `actionable_only` filters the 7-day window but **not** `status='pending'`; also an inline
`text` import + an f-string-interpolated TTL (SQL-injection-shaped smell + not parameterized).

**Fix.** Add the `status == 'pending'` predicate to the filter; bind the interval as a **parameter**
(not f-string-interpolated). Anchors: `api/oss/src/core/sessions/interactions/dtos.py`,
`api/oss/src/dbs/postgres/sessions/interactions/dao.py`.

**Done when:** `actionable_only=true` returns only pending items inside the window; the interval is a
bound parameter, no inline f-string TTL, no stray inline `text` import.

## Non-goals
No behavioural redesign — these are alignment fixes. C-3 lives in the security worktree. QUAL-3 is already
closed (per the assessment).
