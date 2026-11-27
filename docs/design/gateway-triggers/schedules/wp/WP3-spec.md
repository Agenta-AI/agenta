# WP3 — Service & router (schedule CRUD + refresh)

Read `contracts.md` first. Depends on WP2 (DAO methods) and WPD (dispatch signature) — documented.

## Files
- `api/oss/src/core/triggers/service.py`
- `api/oss/src/apis/fastapi/triggers/router.py`
- `api/oss/src/apis/fastapi/triggers/models.py` (request/response envelopes)
- `api/entrypoints/routers.py` (register the admin router)

## service.py — fix broken subscription reads first
- `existing.data.ti_id` (lines 421, 458, 530) → `existing.ti_id`.
- `subscription.enabled` / `existing.enabled` (lines 422, 430) → `.flags.is_active`.
- `existing.valid` (line 551) → `existing.flags.is_valid`.

## service.py — schedule CRUD + refresh (NEW)
- Schedule CRUD reusing the existing `_normalize_references` helper (same one subscriptions use →
  `WorkflowsService.retrieve_workflow_revision`; expands application/evaluator/environment families).
  Raise `TriggerReferenceInvalid` when unresolvable. Edits are full-PUT (memory `feedback_edits_full_put`).
- Cron validation: a helper `_validate_schedule(expr)` that rejects non-5-field / unparseable via
  `croniter` → raise `TriggerScheduleInvalid`. Enforce exactly 5 fields (reject 6-field seconds form).
- `refresh_schedules(*, timestamp, interval)`:
  - `fetch_active_schedules()` (WP2 DAO).
  - For each, fire gate `croniter.match(schedule.data.schedule, timestamp)` (timestamp = the rounded
    `trigger_datetime`). Skip non-matches.
  - For matches, build the trigger event envelope and enqueue dispatch via the schedule path
    (WPD). event_id should be deterministic per (schedule, tick) for dedup, e.g.
    `f"{schedule.id}:{timestamp.isoformat()}"`. Log `[SCHEDULE] Dispatching` / `Dispatched` (mirror
    live-eval `[LIVE]` logs).
- Mirror live-eval `refresh_runs` shape (`core/evaluations/service.py`): `newest/oldest` not needed —
  the cron `match` is point-in-time.

## router.py — routes (NEW)
Register in `__init__` via `self.router.add_api_route(...)` (precedent: subscription routes at
router.py:220-310; `/revoke` at 256-257). Add:
- `POST /schedules` (create), `GET /schedules` (list/query), `GET /schedules/{id}`,
  `PUT /schedules/{id}` (full edit), `DELETE /schedules/{id}`.
- `POST /schedules/{id}/start` and `POST /schedules/{id}/stop` — see WP6 (may be authored there;
  coordinate so they aren't double-added).
- Admin: build `self.admin_router = APIRouter()` (pattern: evaluations router.py:141,146) and add
  `POST /refresh` (params `trigger_interval: int = Query(1, ge=1, le=60)`,
  `trigger_datetime: datetime = Query(None)`; NO auth/entitlement check — admin endpoint). Compute
  `timestamp` and call `triggers_service.refresh_schedules(...)`.
- `@intercept_exceptions()` at each route boundary; catch `TriggerScheduleInvalid` →422,
  `ScheduleNotFoundError`→404, `TriggerReferenceInvalid`→422.

## entrypoints/routers.py
- `TriggersRouter` is built at routers.py:826 and mounted at 1199-1205. Mount the new admin router:
  `app.include_router(router=triggers.admin_router, prefix="/admin/triggers", tags=["Triggers","Admin"], include_in_schema=False)` (mirror evaluations at 1212-1213). The cron POSTs to
  `/admin/triggers/schedules/refresh`, so either set the route path to `/schedules/refresh` on the
  admin_router under prefix `/admin/triggers`, or prefix `/admin/triggers/schedules` with path `/refresh`.
  Pick one and keep WP4's curl URL in sync.
- `triggers_service` needs the schedules DAO (WP2) + the schedule dispatch enqueue (WPD) injected here.

## AC
- Schedule CRUD round-trips; references stored as the full normalized family.
- `/admin/triggers/schedules/refresh` dispatches ONLY schedules whose cron matches the tick.
- Invalid cron → 422 with `TriggerScheduleInvalid` message.
