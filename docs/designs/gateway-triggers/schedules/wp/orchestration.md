# Orchestration — two-wave parallel build

**Status:** WP1 (contract) DONE in working tree. Waiting to fan out the rest after compact.

## The waves

- **Wave 0 (done, serial):** WP1 DTOs + exceptions written to `core/triggers/dtos.py` /
  `exceptions.py`. These are the frozen contract (`contracts.md`). This intentionally broke some
  existing call sites (see §broken) — those are fixed by WP2/WPD/WP3.
- **Wave 1 (parallel subagents):** WP0, WP2, WPD, WP3, WP4, WP6, WP5. Each builds its layer
  against the frozen WP1 contract + its own `WP*-spec.md`. They do **not** import each other's
  not-yet-written code — they code against the documented signatures and we stitch.

## Why these can run in parallel despite the linear DAG

The DAG (`WP1→WP0→WP2→WPD→WP3→WP4`) is a *runtime* dependency. For *authoring*, the WP1 contract
is real code, so each WP can write its files against the frozen types without the others being
done. Stitching is clean because every seam (DTO fields, dispatcher signature, DAO method names)
is pinned in `contracts.md`. Genuinely independent: WP4 (infra) and WP5 (web, different tree).

## Launch grouping (suggested)

All seven can launch at once. If throttling, this order maximizes early stitching:

1. WP0 (migration) + WP2 (DAO/mappings) + WPD (dispatcher) — the api core, against the contract.
2. WP3 (service/router) + WP6 (play/pause + webhook flags) — depend on WPD/WP2 signatures (documented).
3. WP4 (cron infra) + WP5 (web) — fully independent.

## Stitching / verification after Wave 1

1. `cd api && ruff format && ruff check` — must pass (catches contract drift / unused imports).
2. `python -c "import oss.src.apis.fastapi.triggers.router"` (and webhooks router) — import-time
   wiring check; catches signature mismatches at the seams.
3. Run the unit suite: `pytest api/oss/tests/pytest/unit/triggers/ -q`.
4. Migration up/down on a live DB (or CI): `alembic upgrade head` then `downgrade`.
5. Acceptance: schedule CRUD + `/start`·`/stop` round-trips, both editions.

## <a name="broken"></a>Call sites WP1 broke (must be fixed by Wave 1)

These reference the OLD contract (`enabled`/`valid`/`data.ti_id`) and will not run until fixed:

| File:line | Old read | Fix in | New form |
|-----------|----------|--------|----------|
| `tasks/asyncio/triggers/dispatcher.py:96` | `subscription.enabled` | WPD | `entity.flags.is_active` |
| `dbs/postgres/triggers/mappings.py:22` | `_SUBSCRIPTION_FLAGS = ("enabled","valid")` | WP2 | typed flags ser/de |
| `dbs/postgres/triggers/mappings.py:25` | `_flags_to_dbe(enabled, valid)` | WP2 | flags from `TriggerSubscriptionFlags` |
| `dbs/postgres/triggers/mappings.py:52,115-117` | `_flags_to_dbe(...)` | WP2 | as above |
| `core/triggers/service.py:421,458,530` | `existing.data.ti_id` | WP3 | `existing.ti_id` |
| `core/triggers/service.py:422,430` | `subscription.enabled`/`existing.enabled` | WP3 | `.flags.is_active` |
| `core/triggers/service.py:551` | `existing.valid` | WP3 | `existing.flags.is_valid` |

Also `dao.py:220,246` filter `TriggerSubscriptionDBE.data["ti_id"].astext` — WP2 repoints these
to the new `ti_id` column.

## GitButler

Lane for this work: `gateway-triggers-all` (the schedules work continues there) OR a new stacked
lane per the design's fan-out — decide at fan-out time. Per AGENTS.md: one lane's files assigned
at a time, `but commit <lane> --only`, verify with `git show --stat <lane>`, push with
`but push <lane>` then confirm SHAs match `git ls-remote`. Co-author trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
