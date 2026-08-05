# Frozen Contracts (WP1) — build against these

WP1 is **implemented and committed to the working tree** in
`api/oss/src/core/triggers/dtos.py` and `exceptions.py`. These are the FROZEN signatures every
other WP imports against. Do **not** change them; if a WP needs a contract change, stop and flag it.

> ⚠️ WP1 intentionally **broke** existing reads of `subscription.enabled` / `.valid` / `.data.ti_id`.
> Fixing those call sites is the job of WP2/WPD/WP3 (call sites listed in `orchestration.md §broken`).

## Typed flags (NEW)

```python
# core/triggers/dtos.py
class TriggerSubscriptionFlags(BaseModel):
    is_active: bool = True
    is_valid: bool = True          # provider connection still good (Composio revoke)

class TriggerScheduleFlags(BaseModel):
    is_active: bool = True          # no is_valid — schedule has no external connection

# core/webhooks/types.py  (WP6 ADDS THIS — not yet written)
class WebhookSubscriptionFlags(BaseModel):
    is_active: bool = True          # no is_valid — webhooks have no validity concept
```

## Trigger subscription (CHANGED: ti_id promoted, flags typed)

```python
class TriggerSubscriptionData(BaseModel):
    event_key: str
    trigger_config: Optional[Dict[str, Any]] = None     # ti_id REMOVED from here
    inputs_fields: Optional[Dict[str, Any]] = None
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None

class TriggerSubscription(Identifier, Lifecycle, Header, Metadata):
    connection_id: UUID
    ti_id: Optional[str] = None                          # NOW top-level (was data.ti_id)
    data: TriggerSubscriptionData
    flags: TriggerSubscriptionFlags = Field(default_factory=TriggerSubscriptionFlags)
                                                         # was: enabled: bool / valid: bool

class TriggerSubscriptionCreate(Header, Metadata):
    connection_id: UUID
    data: TriggerSubscriptionData

class TriggerSubscriptionEdit(Identifier, Header, Metadata):
    connection_id: UUID
    data: TriggerSubscriptionData
    flags: TriggerSubscriptionFlags = Field(default_factory=TriggerSubscriptionFlags)

class TriggerSubscriptionQuery(BaseModel):
    name / connection_id / event_key   # unchanged
```

## Trigger schedule (NEW)

```python
class TriggerScheduleData(BaseModel):
    event_key: str
    schedule: str                    # 5-field cron expr, UTC, validated via croniter
    inputs_fields: Optional[Dict[str, Any]] = None
    references: Optional[Dict[str, Reference]] = None
    selector: Optional[Selector] = None

class TriggerSchedule(Identifier, Lifecycle, Header, Metadata):
    data: TriggerScheduleData
    flags: TriggerScheduleFlags = Field(default_factory=TriggerScheduleFlags)

class TriggerScheduleCreate(Header, Metadata):
    data: TriggerScheduleData

class TriggerScheduleEdit(Identifier, Header, Metadata):
    data: TriggerScheduleData
    flags: TriggerScheduleFlags = Field(default_factory=TriggerScheduleFlags)

class TriggerScheduleQuery(BaseModel):
    name: Optional[str] = None
    event_key: Optional[str] = None
```

## Trigger delivery (CHANGED: schedule_id added, both ids nullable)

```python
class TriggerDelivery(Identifier, Lifecycle):
    status: Status
    data: Optional[TriggerDeliveryData] = None
    subscription_id: Optional[UUID] = None    # XOR with schedule_id (DB-enforced)
    schedule_id: Optional[UUID] = None
    event_id: str

class TriggerDeliveryCreate(Identifier):       # same fields as above (+ Identifier)
class TriggerDeliveryQuery(BaseModel):         # status / subscription_id / schedule_id / event_id
```
`TriggerDeliveryData` is unchanged (`event_key, references, inputs, result, error`).

## Exceptions (NEW in core/triggers/exceptions.py)

```python
class ScheduleNotFoundError(TriggersError):   # __init__(*, schedule_id: str)
class TriggerScheduleInvalid(TriggersError):  # __init__(message="...5-field cron...")
```
Existing: `TriggersError`, `ProviderNotFoundError`, `SubscriptionNotFoundError`,
`TriggerReferenceInvalid`, `ConnectionNotFoundError`, `AdapterError`.

## Dispatcher contract (WPD defines; WP3/Composio call)

```python
# tasks/asyncio/triggers/dispatcher.py — NEW signature
async def dispatch(self, *, project_id: UUID, entity, event_id: str, event: Dict[str, Any]) -> None
```
- `entity` is a `TriggerSubscription` OR `TriggerSchedule` (duck-typed: both have
  `.flags.is_active`, `.data.{inputs_fields,references,selector}`, `.created_by_id`, `.id`).
- gate: `entity.flags.is_active` False → silent skip. For subscriptions, `flags.is_valid`
  False → fall through to the failed-delivery path (NOT silent).
- `write_delivery` sets `subscription_id` if entity is a subscription, else `schedule_id`.
- The `ti_id` → subscription lookup is REMOVED from `dispatch`; the Composio **worker task**
  does it before calling `dispatch`.

## DB / migration contract (WP0 / WP6)

- `trigger_subscriptions`: new `ti_id` String column + partial unique index
  `(project_id, ti_id) WHERE ti_id IS NOT NULL AND deleted_at IS NULL`. Flags stay JSONB
  (`flags->>'is_active'`, `flags->>'is_valid'`) — no migration column for flags.
- `trigger_schedules` (new table): mirror subscriptions minus `connection_id`/`ti_id`; partial
  active index `(project_id) WHERE flags->>'is_active'='true' AND deleted_at IS NULL`.
- `trigger_deliveries`: `subscription_id` nullable; add `schedule_id` UUID + composite FK
  `(project_id, schedule_id) → trigger_schedules` CASCADE; XOR check
  `(subscription_id IS NULL) <> (schedule_id IS NULL)`; two partial unique dedup indexes.
- All of the above edited **in place** in `oss000000003` (unreleased).
- `webhook_subscriptions`: NEW `oss000000004` (core_oss, data-only) — backfill
  `flags.is_active=true` + partial active index. Column already exists.

## House conventions (from api/AGENTS.md — apply in every WP)

- keyword-only params (`*`); `#`-grouped signature sections.
- Router → Service → DAO Interface → DAO Impl → DB. Domain exceptions in `core/.../exceptions.py`,
  caught at the router boundary. Never raise HTTPException from services.
- Lifecycle routes use `POST /{id}/<verb>` (precedent: `/archive`, `/revoke`). We use
  `/{id}/start` + `/{id}/stop`.
- Services return typed DTOs, never dicts/tuples. Mapping lives in `dbs/postgres/*/mappings.py`.
- `ruff format` then `ruff check --fix` before done.
