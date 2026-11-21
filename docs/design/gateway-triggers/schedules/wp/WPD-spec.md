# WPD — Dispatcher refactor (entity-agnostic dispatch)

Read `contracts.md` first.

## Files
- `api/oss/src/tasks/asyncio/triggers/dispatcher.py`
- `api/oss/src/tasks/taskiq/triggers/worker.py`
- `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` (add `is_active` gate)

## Triggers dispatcher (`tasks/asyncio/triggers/dispatcher.py`)
CURRENT: `dispatch(*, trigger_id, event_id, event)` does the `ti_id` lookup (calls
`get_project_and_subscription_by_trigger_id`), then gates on `subscription.enabled` (line 96),
dedups, builds context, invokes, writes delivery.

NEW signature (frozen in contracts.md):
```python
async def dispatch(self, *, project_id: UUID, entity, event_id: str, event: Dict[str, Any]) -> None
```
- REMOVE the `ti_id` lookup from the body. `entity` is a `TriggerSubscription` OR `TriggerSchedule`.
- Gate: `if not entity.flags.is_active: return` (silent skip). For a subscription, if
  `not entity.flags.is_valid` do NOT silent-skip — let it proceed and land in the existing
  failed-delivery branch (so the user sees why). (Schedules have no `is_valid`.)
- `_build_context`, mapping (`entity.data.inputs_fields/references/selector`), invoke,
  `write_delivery` stay as-is — but `write_delivery` now sets `subscription_id` if the entity is a
  subscription, else `schedule_id`. Use `isinstance` or a small `entity_kind` discriminator.
- `created_by_id` / `id` reads work for both (both have them via Lifecycle/Identifier).

## Triggers worker (`tasks/taskiq/triggers/worker.py`)
CURRENT task `triggers.dispatch` (worker.py:33) calls `self.dispatcher.dispatch(trigger_id, event_id, event)`.
- The **Composio path** must now do the `ti_id` → (project_id, subscription) lookup HERE (the worker
  runs async off the queue, so the DAO call is fine — unlike the HTTP ingress which must stay fast).
  Then call the new `dispatch(project_id=..., entity=subscription, ...)`. If lookup returns None,
  keep the existing "unknown trigger_id — skip" behavior.
- The worker needs the DAO. Wiring is in `entrypoints/routers.py` (`_triggers_dispatcher` /
  `_triggers_worker`); coordinate with WP3 if a new task (e.g. `triggers.dispatch_schedule`) is added.
- **Schedule path:** WP3's `refresh_schedules` enqueues a task that already has the schedule row (or
  its id+project) and calls `dispatch(entity=schedule, ...)` — no lookup. Decide with WP3 whether
  this is the same task with an `entity_kind` arg or a second task; document the choice in the code.

## Webhook dispatcher (`tasks/asyncio/webhooks/dispatcher.py`)
- Add an `is_active` gate: after resolving the webhook subscription, `if not
  subscription.flags.is_active: <silent skip>`. Today there is NO flag gate. Requires WP6's
  `WebhookSubscriptionFlags` + webhook mappings reading flags — coordinate; if WP6's flag model
  isn't merged yet, code against the documented `subscription.flags.is_active`.

## AC
- Existing dispatcher unit tests updated for the new signature and pass
  (`api/oss/tests/pytest/unit/triggers/test_triggers_dispatcher.py` — the `_make_subscription`
  helper uses `enabled=`; update to `flags`).
- Composio happy path unchanged end-to-end (event → invoke → delivery with `subscription_id`).
- A paused webhook subscription does not dispatch.
