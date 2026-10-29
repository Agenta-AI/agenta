# WP0 (REVISED 2026-07-18) — Sessions-list residual for mobile

> **EXECUTED 2026-07-25 — ALL FOUR TASKS COMPLETE AND DUAL-REVIEWED** on
> `feat/agenta-mobile-wave-1` (9 commits `117cd6e4`…`ab7b09ad`; commit/review table in
> [../README.md](../README.md)). Notable execution deltas vs this plan text: R1 evolved through
> review into `coalesce(updated_at, created_at)` ordering (NULL-safe) plus a direction-matched
> id tiebreak fixed in the SHARED `apply_windowing` (latent dup/skip bug for all 18 call sites);
> R2 additionally trims the search term; R3 chose a core `SessionListItem` DTO (per api layering)
> and added the batch `latest_turn_per_session` DISTINCT-ON helper; R4's fixture was corrected in
> review to be server-faithful (no `status` key, UUID reference ids).

> **RE-AUDITED 2026-07-25 against PR #5479 tip (`3c78268700`, storage-rework base) — ALL FOUR
> TASKS STILL NEEDED.** Verified: `apply_windowing` still lacks `updated_at`; no `search`
> anywhere; rows still carry no references (service explicitly declines denormalization, B3);
> no zod query test. Corrections to the task details below (authoritative over the older text):
>
> - **R1**: additionally surface `windowing` (cursor params) on the FE `querySessions` wrapper —
>   the Fern type already carries it; the wrapper doesn't pass it. R1's value is higher now:
>   archive/auto-unarchive bump `updated_at` without changing the uuid7 `id`, so creation-order
>   sorting is visibly wrong for active sessions.
> - **R2**: `search` must thread through BOTH the core `SessionQuery` AND `SessionStreamQuery`
>   (the service builds the latter for the DAO). FE param needs a Fern regen or a temporary
>   typed cast. Coverage caveat: auto-title is FE-only (OSS `autoTitleSessionAtomFamily` →
>   `setSessionHeader`), so `name` is NULL for sessions never touched by a titling client.
> - **R3**: `SessionTurnsDAO` has NO batch latest-turn helper (only per-session `latest_turn` and
>   `latest_turn_per_harness_kind`) — add `latest_turn_per_session(session_ids)` using
>   `DISTINCT ON (session_id) … ORDER BY session_id, turn_index DESC` so hydration stays one query.
> - **R4**: unchanged; also pin `archived_at` (new column) and, post-R3, `references`.
>
> New track capabilities recorded for wave-2 planning (not in this plan): archive/unarchive
> endpoints + `include_archived`/`include_ended` flags (mobile default list must filter
> `archived_at` client-side — wrapper defaults include_archived:true); auto-unarchive on new
> turn; delete-vs-kill semantics for swipe actions; lift the FE auto-title write path into
> `@agenta/entities` so mobile sessions get titles.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISION NOTICE.** The original 2026-07-12 WP0 plan (heartbeat `tags` stamping, a
> `SessionSummary` projection on `SessionStreamsRouter`, an interim axios wrapper) is
> **superseded**: the sessions-extensions track landed on this branch during the week of
> 2026-07-17 and built the list/title/linkage capabilities through a different architecture.
> Do not implement the original plan. This revision contains only the mobile residual.

**Goal:** Close the four remaining gaps between the as-built sessions surface and what the
mobile sessions list (WP4) needs: last-activity ordering on the server, title search,
agent-references echoed on list rows, and a runtime-shape zod test for `querySessions`.

**Architecture (as built, verified 2026-07-18):**

- `POST /sessions/query` lives on `SessionsRootRouter` → `SessionsService`
  (`api/oss/src/apis/fastapi/sessions/router.py` ~L1190-1338; `api/oss/src/core/sessions/service.py`),
  backed by `SessionStreamsDAO.query` (`api/oss/src/dbs/postgres/sessions/streams/dao.py` ~L118-154).
  Filters: `references` (joined through `session_turns.references`, `service.py` ~L57-76) and
  `include_ended`. Returns full `SessionStream` rows (title = `name` header from migration 015).
- Agent linkage: `session_turns.references` (migration 014, GIN jsonb_path_ops), stamped by the
  runner's per-turn `appendSessionTurn` with `buildWorkflowReferences(runContext.workflow)` +
  `trace_id` (`services/runner/src/engines/sandbox_agent.ts` ~L2255-2273). Heartbeats carry no tags.
- FE: Fern-backed `querySessions` in `web/packages/agenta-entities/src/session/api/api.ts`
  (~L256-279) over `sessionsQueryResponseSchema` (`.../session/core/schema.ts` ~L90-122);
  app-scoped list atom `projectSessionsQueryAtomFamily`
  (`web/oss/src/components/AgentChatSlice/state/projectSessions.ts`) + server-over-localStorage
  reconciler (`.../state/sessions.ts` ~L317+).

**Tech Stack:** FastAPI/Pydantic v2/SQLAlchemy async + pytest (`cd api && uv run pytest`), ruff;
vitest for `@agenta/entities`.

**Grounding rule:** the cited line numbers are from a 2026-07-18 audit of an actively developed
track — before each task, READ the cited files and re-anchor; if the surface moved again,
adapt in place rather than following stale line refs. Never include Claude/Anthropic/Co-Authored-By
in commit messages.

---

## Task R1 — `updated_at` ordering + cursor on the sessions query

The DAO currently windows on `id` (uuid7 ≈ creation order) and the FE compensates with a
client-side per-page sort — which breaks last-activity ordering across pages for infinite
scroll. `session_streams.updated_at` is heartbeat-fed last activity.

**Files**
- Modify: `api/oss/src/dbs/postgres/shared/utils.py` (`apply_windowing` attribute resolution)
- Modify: `api/oss/src/dbs/postgres/sessions/streams/dao.py` (`query` — switch windowing attribute to `updated_at`)
- Test (create): `api/oss/tests/pytest/unit/sessions/test_query_sessions_windowing.py`

**Steps**
- [ ] Write the failing statement-compilation test (no DB):

```python
"""apply_windowing must support `updated_at` as the order/cursor attribute.

The sessions list is ordered by last activity (`updated_at` is heartbeat-fed on
session_streams). Both ORDER BY and the keyset cursor filters must ride the SAME
expression — ordering by one column while cursor-filtering on another paginates
incorrectly.

That expression is `coalesce(updated_at, created_at)`, not bare `updated_at`:
`updated_at` is nullable, and a DESC sort puts NULLs first in Postgres, so a session
that never got a heartbeat would sit above every active one. The full statement
therefore mentions `created_at` by design — assert on the coalesced expression, not on
the absence of that column.
"""

from datetime import datetime, timezone

import uuid_utils.compat as uuid
from sqlalchemy import select

from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE
from oss.src.dbs.postgres.shared.utils import apply_windowing


def _sql(stmt) -> str:
    return str(stmt.compile())


def test_orders_by_updated_at_descending_with_id_tiebreak():
    stmt = apply_windowing(
        stmt=select(SessionStreamDBE),
        DBE=SessionStreamDBE,
        attribute="updated_at",
        order="descending",
        windowing=Windowing(limit=20),
    )
    sql = _sql(stmt)
    assert "ORDER BY session_streams.updated_at DESC, session_streams.id" in sql


def test_cursor_filters_ride_updated_at():
    windowing = Windowing(
        newest=datetime(2026, 7, 17, tzinfo=timezone.utc),
        next=uuid.uuid7(),
        limit=20,
    )
    stmt = apply_windowing(
        stmt=select(SessionStreamDBE),
        DBE=SessionStreamDBE,
        attribute="updated_at",
        order="descending",
        windowing=windowing,
    )
    sql = _sql(stmt)
    assert "session_streams.updated_at <" in sql
    assert "session_streams.id <" in sql
    assert "session_streams.created_at" not in sql
```

- [ ] Run: `cd api && uv run pytest oss/tests/pytest/unit/sessions/test_query_sessions_windowing.py -v` — expect FAIL (attribute map falls back to `created_at`/`id`).
- [ ] Extend `apply_windowing`'s attribute-resolution map with `updated_at` (add
  `updated_at_attribute = DBE.updated_at if getattr(DBE, "updated_at", None) else None`, register
  it in the lookup dict, and when `attribute == "updated_at"` make the cursor `time_attribute`
  ride it too). Read the current function first — do not disturb the existing `id`/`span_id`/
  `created_at`/`start_time` behavior; add a regression assertion for `created_at` if the file
  changed since the audit.
- [ ] In `SessionStreamsDAO.query`, switch the windowing call to `attribute="updated_at",
  order="descending"` and make the no-windowing fallback `ORDER BY updated_at DESC, id DESC`.
  Check for other callers of this DAO method first (`grep -rn "streams_dao.query\|\.query(" api/oss/src/core/sessions/`)
  — if the streams-scoped `/sessions/streams/query` route shares it, confirm the ordering change
  is acceptable there too (it is a liveness index; ordering is not load-bearing) or thread an
  `order_by` parameter instead.
- [ ] Run the new test (PASS) + the whole sessions unit suite:
  `cd api && uv run pytest oss/tests/pytest/unit/sessions/ -v` — all green.
- [ ] Remove the now-redundant client-side sort note: in
  `web/oss/src/components/AgentChatSlice/state/projectSessions.ts`, keep the `activity()` sort
  (harmless belt-and-suspenders for mixed pages) but update its comment to note the server now
  orders by `updated_at`.
- [ ] `cd api && ruff format . && ruff check --fix .`; commit:
  `feat(api): order /sessions/query by last activity (updated_at windowing)`

---

## Task R2 — Title search on `SessionQuery`

`session_streams.name` is a real column now — search is a plain escaped `ilike`, not the JSONB
gymnastics the original plan needed.

**Files**
- Modify: `api/oss/src/core/sessions/dtos.py` (`SessionQuery` — add `search: Optional[str] = None`)
- Modify: `api/oss/src/core/sessions/service.py` + the DAO path it uses for the stream query
  (thread `search` down; apply `SessionStreamDBE.name.ilike(f"%{escaped}%", escape="\\")` with
  `%`/`_`/`\\` escaped)
- Modify: `web/packages/agenta-entities/src/session/api/api.ts` (`querySessions` — add optional
  `search` param, pass through)
- Test (create): `api/oss/tests/pytest/unit/sessions/test_query_sessions_search.py` (service-level
  with a fake DAO asserting the filter is forwarded, plus a DAO statement-compilation test
  asserting the `ilike` + escaping appears in SQL and absent when `search` is None)

**Steps**
- [ ] Failing tests first (both assertions above), run, expect FAIL.
- [ ] Implement DTO + service/DAO threading + FE param. Match the track's style (read
  `SessionQuery`'s current shape first — it may have grown since the audit).
- [ ] Tests PASS; sessions suite green; `ruff format`/`check`; FE `cd web && pnpm lint-fix` +
  `pnpm turbo run types:check --filter=@agenta/entities`.
- [ ] Commit: `feat(api): free-text title search on /sessions/query`

---

## Task R3 — Echo latest-turn references on session list rows

List rows carry no agent linkage, but the mobile list must label each row with its agent and
resolve continue-session without N per-session turn lookups. The service already joins turns for
the references *filter*; extend it to hydrate.

**Files**
- Modify: `api/oss/src/core/sessions/service.py` (`query_sessions` — after fetching streams,
  batch-fetch the latest turn per session via `SessionTurnsDAO` and attach `references` (+
  `trace_id` if cheap) to each row). This needs a NEW batch helper —
  `latest_turn_per_session(session_ids)`, one `DISTINCT ON (session_id) ... ORDER BY
  session_id, turn_index DESC` query. The existing latest-turn helper from the turn-index fix
  `9613e7964e` takes a single session and would make `/sessions/query` an N+1 path; do not use
  it here. Keep the one-call assertion in the service test.
- Modify: response model — either add `references`/`latest_turn` to the session row model the
  root query returns, or wrap rows in an enriched envelope; follow whichever the track's
  maintainer style suggests (read `SessionsResponse` in `api/oss/src/apis/fastapi/sessions/models.py` first)
- Modify: `web/packages/agenta-entities/src/session/core/schema.ts` (extend the session row
  schema with nullish `references`)
- Test: extend/service-level unit test with a fake turns DAO (rows with turns get references;
  rows without turns get null; ONE batch call, not N)

**Steps**
- [ ] Failing service test (assert the fake turns DAO is called once with all session ids and the
  mapping lands per row), run, FAIL.
- [ ] Implement; tests PASS; suite green; ruff; FE schema updated + typecheck.
- [ ] Commit: `feat(api): include latest-turn references on /sessions/query rows`

---

## Task R4 — Runtime-shape zod test for `querySessions`

The wrapper + schema exist but the drift-pinning test was never written — this is the exact
false-green-tsc class that has bitten the session schemas twice before.

**Files**
- Test (create): `web/packages/agenta-entities/tests/unit/session-query-schema.test.ts`

**Steps**
- [ ] Mirror `tests/unit/session-record-schema.test.ts`'s structure: pin a realistic wire row
  (id, session_id, `name`/`description`, flags nest, tags, timestamps — capture one from a live
  `POST /sessions/query` response if a stack is running, else hand-author from the current
  Pydantic model) through `sessionsQueryResponseSchema`, asserting the parsed shape the FE
  consumes (title from `name`, flags normalized, timestamps present). Add a case for an
  `include_ended` soft-deleted row (`deleted_at` set) and — after Task R3 — a row with
  `references`.
- [ ] Run: `cd web/packages/agenta-entities && pnpm vitest run tests/unit/session-query-schema.test.ts` — PASS.
- [ ] Commit: `test(web): pin the /sessions/query wire shape in @agenta/entities`

---

## Not in this plan

- **Everything the sessions-extensions track already built** — the list endpoint, root
  delete/archive/unarchive, the turns domain and runner turn-append stamping, the
  `name`/`description` header + rename endpoint, the Fern regen, `querySessions`,
  `projectSessionsQueryAtomFamily`, and the server-over-localStorage reconciler.
- **Liveness-flags filter on the root query** — mobile filters client-side from the returned
  `flags` in v1; add server-side only if list sizes demand it.
- **Fern regen for `include_ended`** (currently a runtime cast in the wrapper) — ride the next
  scheduled client regen; not worth a standalone one.
- **Mobile UI consumption** (WP4) and the project-wide list atom for mobile (the OSS atom is
  app-scoped by design; mobile calls `querySessions` without `references`).
- **Trace-derived references fallback for pre-turns sessions** — sessions with no turn rows
  degrade to read-only replay; self-heals as sessions accrue turns.
