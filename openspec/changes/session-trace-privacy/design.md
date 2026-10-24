# Design: session trace privacy

## Context

Tracing is a separate database, so core cannot join access rows in SQL. Code facts: `research-session-trace-privacy.md`.

## Decisions

### 1. Read semantics

A span in project P is readable by principal X if and only if:

1. X passes `VIEW_SPANS` in P, and
2. no span of the same trace carries a session id that names a session of P that X may not read.

A session id names a session of P when P has a live session row or a privacy tombstone with that id. "May read" for a live session is the M3 rule. A tombstone is readable only by its former owner. A trace with no such session id keeps rule 1 only.

### 2. Privacy tombstone

`session_trace_tombstones` (core_oss): `project_id`, `session_id`, `owner_user_id`, `deleted_at`; PK `(project_id, session_id)`. `SessionsService.delete_session` writes it, for a private session, in the transaction that deletes the stream row. Session deletion leaves spans to tracing retention, so the tombstone must outlive the row. The EE retention flush deletes a tombstone once `deleted_at` is older than the plan's retention plus one day. With unlimited retention (OSS, some plans) it stays.

### 3. Linkage

The filter works per trace, so a child span follows its trace. Emitters stamp the session id on every span of a session run; ingest keeps it on every carrying span and copies the root's value to children in the same batch. Old root-only spans need no backfill.

### 4. One read-scope boundary

```python
class MaintenanceOperation(str, Enum):
    INGEST = "ingest"                    # linkage promotion inside ingest
    USAGE_WRITE_BACK = "usage_write_back"

class SpanReadScope(BaseModel):          # built only by TraceAccessService
    project_id: UUID
    principal: PrincipalRef | None       # None only for maintenance
    maintenance: MaintenanceOperation | None
    restricted: bool                     # the scope can remove data for this reader
    # the filter payload is defined by the measurement step (tasks 3.x)

class TraceAccessService:
    async def read_scope(self, *, authority: RunAuthority | None, principal: PrincipalRef, project_id: UUID) -> SpanReadScope
    def maintenance(self, *, project_id: UUID, operation: MaintenanceOperation) -> SpanReadScope
```

`scope` is a required keyword with no default on every `TracingService` and `TracingDAOInterface` read. The DAO applies it before ordering, counting and paging. Services never build their own scope; they pass the caller's. Adding a maintenance operation is a spec change.

### 5. Measurement step, then strategy

Before building the filter, measure on production: unreadable sessions per (reader, project) at p50, p99 and maximum, tombstones per project, and candidate SQL cost on the largest tracing projects. The chosen filter payload, and any tracing-database change, is recorded with the numbers for owner review. Decision 1 and the scope argument do not change with the choice.

### 6. Per-turn usage

`session_turns` gets nullable `input_tokens`, `output_tokens`, `total_tokens` (bigint), `cost` (numeric 18,9), `usage_source` (`runner` or `trace`), and a concurrent index `(project_id, trace_id)`. `complete_turn` takes optional runner usage. Ingest, after `cumulate_costs`, calls `SessionTurnsService.record_trace_usage(project_id, trace_id, usage)` for linked roots. `TurnMetrics` loads the trace only when opened.

### 7. Unavailable, never zero

Analytics responses add `access: {restricted: bool}`. Scope errors are excluded from `@suppress_exceptions`, which today turns every analytics failure into an empty result.

## Migration and mixed-version behavior

- Core (`core_oss`): nullable usage columns, the concurrent index, and the tombstone table. No backfill required.
- Tracing (`tracing_oss`): only if the measured strategy needs it.
- New runner, old API: the completion DTO ignores unknown fields, so the trace write-back fills usage later. Old runner, new API: same. Old runners stamp only the root, so their child spans are unlinked until the root arrives; the runner exports a trace at run end, usually in one batch.
- Tombstone writes ship in the first release, before the filter exists. A private session deleted by a pod without the tombstone write leaves no tombstone.
- The filter is behind a flag, turned on after every pod applies scopes. In the same release, the sharing screen stops showing the M3 trace-reader disclosure. Turning the flag off reopens the exception, and the disclosure returns with it.

## Risks

- Restricted totals undercount for readers who cannot read every session. Billing stays exact.
- Customer SDK spans that reuse an Agenta session id become private with that session. Document it.

## Open questions

1. Private sessions deleted before the tombstone release keep traces visible to trace readers (as under M3). Recommendation: accept; ship the tombstone write first.
2. `access.restricted` tells a reader that other users have private sessions in the project. Recommendation: accept.
3. Project admins see filtered totals too. Recommendation: later, content-free totals from turn usage with an analytics permission.
