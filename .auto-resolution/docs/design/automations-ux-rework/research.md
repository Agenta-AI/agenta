# Research

## Architecture Overview

### Event delivery pipeline

```
User action (deploy) -> publish_event() -> Redis Streams (streams:events)
    -> EventsWorker -> WebhooksDispatcher.dispatch()
        -> Loads all project subscriptions from DB
        -> Filters: is_valid=True AND event_type matches
        -> For each match: enqueues TaskIQ deliver_task
            -> deliver_webhook() makes HTTP POST
            -> Creates delivery record in DB
```

### Test event pipeline (current)

```
POST /subscriptions/{id}/test -> service.test_webhook()
    -> Loads subscription from DB (validates existence)
    -> Publishes WEBHOOKS_SUBSCRIPTIONS_TESTED event to Redis
    -> Polls DB for delivery record (up to 20x @ 500ms = ~10s max)
    -> If delivery.status.message == "success": dao.enable_subscription() sets is_valid=True
    -> Returns delivery
```

### Key constraint: `is_valid` is a hard gate

In `dispatcher.py:223-233`, real events are only delivered to subscriptions where `flags.is_valid == True`. Test events bypass this by matching on `subscription_id` directly (line 216-221).

## File inventory

### Backend

| File | Role |
|------|------|
| `api/oss/src/apis/fastapi/webhooks/router.py` | Route registration + handlers |
| `api/oss/src/apis/fastapi/webhooks/models.py` | Request/response Pydantic models |
| `api/oss/src/core/webhooks/service.py` | Business logic: create, edit, test, secret resolution |
| `api/oss/src/core/webhooks/types.py` | DTOs, flags, constants |
| `api/oss/src/core/webhooks/interfaces.py` | DAO interface |
| `api/oss/src/dbs/postgres/webhooks/dao.py` | Postgres DAO, `enable_subscription` method |
| `api/oss/src/dbs/postgres/webhooks/mappings.py` | DTO <-> DBE mapping |
| `api/oss/src/dbs/postgres/webhooks/dbes.py` | SQLAlchemy entities |
| `api/oss/src/tasks/asyncio/webhooks/dispatcher.py` | Event dispatcher (is_valid gate lives here) |
| `api/oss/src/tasks/taskiq/webhooks/tasks.py` | `deliver_webhook()` - self-contained HTTP delivery |

### Frontend

| File | Role |
|------|------|
| `web/oss/src/components/pages/settings/Automations/Automations.tsx` | Table page with status column + test/edit/delete actions |
| `web/oss/src/components/Automations/AutomationDrawer.tsx` | Create/edit drawer form |
| `web/oss/src/components/Automations/AutomationFieldRenderer.tsx` | Dynamic field rendering per provider |
| `web/oss/src/components/Automations/assets/constants.ts` | Schema definitions, GitHub templates |
| `web/oss/src/components/Automations/assets/types.ts` | Field descriptor types |
| `web/oss/src/components/Automations/utils/buildSubscription.ts` | Form values -> API payload |
| `web/oss/src/components/Automations/utils/buildPreviewRequest.ts` | Request preview builder |
| `web/oss/src/components/Automations/utils/handleTestResult.ts` | Test result -> toast message |
| `web/oss/src/services/automations/api.ts` | API client functions |
| `web/oss/src/services/automations/types.ts` | TypeScript types for webhook entities |
| `web/oss/src/state/automations/atoms.ts` | Jotai atoms: query + mutations |
| `web/oss/src/state/automations/state.ts` | UI state atoms (drawer open, editing, etc.) |

## Key discoveries

### `deliver_webhook()` is fully self-contained

All data (URL, headers, secret, payload) is passed inline. No DB reads during execution. The function docstring explicitly states this design. This means a test-draft endpoint can call the delivery logic directly without a persisted subscription.

### No FK constraint on deliveries -> subscriptions

`webhook_deliveries.subscription_id` is a plain UUID column with no foreign key. Synthetic IDs work for draft tests.

### Secret handling

- On create: service generates a signing secret (or uses provided one), stores in vault via `VaultService`, gets back a `secret_id`.
- On test: dispatcher loads subscription, resolves secret via `secret_id` from vault, encrypts with Fernet, passes to delivery task.
- `deliver_webhook()` receives `encrypted_secret` (Fernet-encrypted string), calls `decrypt()` to use it.
- For draft tests: the raw secret can be encrypted at the call site with `encrypt(raw_secret)` and passed directly.

### The `is_valid` flag has been removed from edit preservation

In the current branch's `mappings.py` diff, the code that preserved `is_valid` during edits was deleted:
```python
# REMOVED:
# if "is_valid" in existing_flags:
#     merged_flags["is_valid"] = existing_flags["is_valid"]
```
This means the service's `WebhookSubscriptionFlags(is_valid=False)` on edit ALWAYS resets the flag, which is the behavior we're fixing.

### Auto-ping: fire-and-forget via event publishing

The simplest approach for auto-ping is to call `publish_event()` with a `WEBHOOKS_SUBSCRIPTIONS_TESTED` event at the end of create/edit. The existing pipeline handles delivery asynchronously. No polling, no latency added to the API response.

However, for this to work without the `is_valid` gate, the subscription must already be `is_valid=True` (or the gate must be removed). Since Checkpoint 1 removes the gate by making subscriptions always active, the auto-ping becomes purely diagnostic - it produces a delivery record the user can check, but doesn't control whether events flow.

### Dispatcher test-event matching

For test events (`WEBHOOKS_SUBSCRIPTIONS_TESTED`), the dispatcher matches by `subscription_id` from event attributes, bypassing the `is_valid` check entirely (dispatcher.py:209-214). This means test events always reach their target subscription regardless of flags.
