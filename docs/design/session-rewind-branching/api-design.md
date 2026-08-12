# API and frontend contracts

## Immediate pull request 5860 contract

The immediate fix remains frontend-owned and adds no HTTP contract.

### Persisted frontend execution state

Reload safety requires the complete action that bootstraps the child, not only a replay marker.
This is execution state, not lineage metadata. Store it separately from the session header:

```typescript
type ForkBootstrap =
    | {
          mode: "edit"
          draft: string
          requestState: "pending" | "in-flight"
      }
    | {
          mode: "rerun"
          requestState: "pending" | "in-flight"
      }

type ForkBootstrapBySession = Record<string, ForkBootstrap>
```

Use a local storage-backed Jotai atom with a new storage key, for example:

```text
agenta:agent-chat:fork-bootstrap:v1
```

The retained messages remain in the existing local message store. The write rules are:

- Store edit or rerun mode when `rewindForkAtomFamily` creates the child.
- Store the restored user draft for edit mode.
- Restore the draft or automatic rerun behavior when the child mounts after reload.
- Read it when `buildAgentRequest` decides whether to disable last-message-only optimization.
- Mark it `in-flight` only when transport dispatch begins.
- Treat an `in-flight` bootstrap restored after page reload as `pending`, because the browser stream
  that owned it no longer exists.
- Keep it through error, abort, and disconnect.
- Clear it only when the first request completes successfully.
- Delete it when the child session is permanently deleted.

Do not store this bootstrap inside `AgentChatSession.lineage`. It controls one request and has a
shorter lifecycle than descriptive session relationships.

### Frontend session header

For this pull request, extend the session creation writer so a new local session may receive a
title:

```typescript
interface AddSessionInput {
    title?: string
}
```

`rewindForkAtomFamily` reads the source session and creates the child with:

```text
<source title> (branch)
```

If the source has no title, existing auto-title behavior remains. If the source has a title, persist
the child title through the existing session-header API. This is one header request, not a second
request in addition to auto-title. The current frontend session type does not carry description, so
description support stays in the durable backend project.

### First-request completion

The AI SDK completion callback exposes abort, disconnect, and error flags. The bootstrap is cleared
only when all are false. The exact callback shape must follow the pinned AI SDK version.

## Durable fork endpoint

The durable project should create the child session and lineage atomically in the core database.

```http
POST /sessions/{source_session_id}/fork
```

Request:

```json
{
  "target_session_id": "session-B",
  "inherited_turn_count": 2,
  "header": {
    "name": "Customer investigation (branch)",
    "description": "Investigating the failed checkout"
  }
}
```

Field roles:

| Field | Role | Owner | Lifecycle |
|---|---|---|---|
| `source_session_id` | Source identity in the path | Caller | One fork operation |
| `target_session_id` | Idempotent target identity | Caller | Lifetime of child session |
| `inherited_turn_count` | Data cursor over complete effective turns | Caller | Immutable lineage |
| `header` | Descriptive metadata override | Caller and product UI | Editable after creation |

The server copies the source header when `header` is absent. When fields are supplied, they override
the copied values. Omission means copy; an explicit empty string means clear.

Before opening the core database transaction, the service resolves `inherited_turn_count` against
the source's effective transcript and identifies the final inherited physical record. The public
request stays turn-based; `cutoff_session_id` and `cutoff_record_id` are internal lineage fields.

Response:

```json
{
  "session": {
    "session_id": "session-B",
    "name": "Customer investigation (branch)",
    "description": "Investigating the failed checkout"
  },
  "lineage": {
    "root_session_id": "session-A",
    "parent_session_id": "session-A",
    "inherited_turn_count": 2
  }
}
```

Validation:

- Source and target IDs pass existing session ID validation.
- Source exists in the caller's project.
- Target does not identify an unrelated existing session.
- The source effective transcript contains the requested number of complete turns.
- A nonzero inherited prefix resolves to a physical cutoff record.
- The target cannot be its own ancestor.
- The lineage depth stays below a configured safety ceiling.
- A running source is rejected unless the selected cutoff is already complete and the product
  explicitly accepts snapshotting a stable prefix.

Idempotency:

- Repeating the same source, target, and cutoff returns the existing fork.
- Reusing the target with different lineage returns a conflict.

## Effective transcript endpoint

Keep the existing records endpoint physical:

```http
POST /sessions/records/query
```

It continues to return only records written under the requested session ID. Inspector and
observability consumers may need that exact provenance.

Add a logical transcript endpoint:

```http
POST /sessions/transcript/query
```

Request:

```json
{
  "session_id": "session-B"
}
```

Response:

```json
{
  "session_id": "session-B",
  "count": 42,
  "records": [
    {"session_id": "session-A", "turn_id": "A1", "record_index": 0},
    {"session_id": "session-A", "turn_id": "A2", "record_index": 0},
    {"session_id": "session-B", "turn_id": "B1", "record_index": 0}
  ]
}
```

Existing `SessionRecord.session_id` already identifies provenance. The response does not rewrite
source IDs or add a misleading `inherited` field. A consumer can compare each record's session ID
with the requested session ID.

The frontend hydration and runner reconstruction switch from physical records to this effective
transcript. The Inspector may expose both effective conversation context and child-only physical
events as distinct views.

## Session list contract

Add optional lineage to `SessionListItem` so the existing sessions query can render branch labels
without another frontend request:

```json
{
  "session_id": "session-B",
  "name": "Customer investigation (branch)",
  "lineage": {
    "root_session_id": "session-A",
    "parent_session_id": "session-A",
    "inherited_turn_count": 2
  }
}
```

The API must batch this lookup for the complete page. It must not fetch lineage once per session.

## Branch-family query

A branch tree UI may later need all descendants:

```http
POST /sessions/lineage/query
```

```json
{
  "root_session_id": "session-A"
}
```

This endpoint is not required for the first durable fork if the UI continues to show each branch as
an independent History row. Add it only when a branch-family UI has a caller.

## Durable frontend model

The server summary maps to:

```typescript
interface AgentChatSession {
    id: string
    title?: string
    description?: string
    createdAt?: number
    lastMessageAt?: number
    lineage?: {
        rootSessionId: string
        parentSessionId: string
        inheritedTurnCount: number
    }
}
```

Durable fork flow:

1. Count the complete visible turns before the selected UI turn.
2. Call the fork endpoint.
3. Add the returned child summary to local state and make it active.
4. Optimistically show the retained local prefix while transcript hydration resolves.
5. Send the edited or copied user prompt as the child's first turn.
6. Let the runner load the effective transcript from the server.

The durable flow removes `replayHistory` and the persisted bootstrap because the runner no
longer depends on a browser-supplied prefix.

## Fork transaction ownership

The stream and lineage rows live in the same core Postgres database, but existing DAOs open and
commit their own sessions. The fork service must not call two independent create methods and claim
atomicity.

Add a composite database operation, behind a core DAO interface, that owns one SQLAlchemy session
and transaction. It inserts the child `session_streams` row, the `session_lineage` row, and any
`session_attachment_access` rows. Unique constraints make an identical target retry idempotent; a
conflicting target causes the entire transaction to roll back.

The tracing-store cutoff lookup happens before this core transaction because the two stores cannot
share a SQL transaction. If cutoff resolution fails, do not start the core transaction. Once
resolved, the source log is append-only and the selected cutoff remains stable.
