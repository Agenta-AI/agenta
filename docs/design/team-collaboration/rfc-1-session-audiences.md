# RFC 1: Session audiences

## Scope

This RFC first adds a correct **My sessions** view, then introduces personal and Project audiences.
It uses session-specific storage and one authorization service. Named sharing is RFC 2.

## Current behavior

The session root carries lifecycle `created_by_id`, and backend responses include it. The frontend
schema drops it. `/sessions/query` has no origin-plus-creator predicate. Every caller with
`view_sessions` receives Project-wide rows.

Creator stamping is incomplete. Explicit commands and rename-first creation stamp the user.
Heartbeat-first creation writes no creator. Triggered sessions use the trigger creator.

References:

- `api/oss/src/dbs/postgres/sessions/streams/dbes.py:23-84`
- `api/oss/src/core/sessions/streams/service.py:554-588,651-696,804-888`
- `api/oss/src/apis/fastapi/sessions/router.py:475-497,1661-1767`
- `web/packages/agenta-entities/src/session/core/schema.ts:133-169`

## Slice 1: My sessions

Add a server-side filter for human/manual origin plus `created_by_id`. Push it into SQL before
count and pagination. Expose `created_by_id` in the frontend schema and add **My sessions** and
**Project sessions**.

This is one slice, not a temporary client-only implementation. It remains authorization-neutral:

- Both views contain Project-visible sessions.
- Direct URLs and APIs remain available to other Project members.
- The UI displays **Created by you** and **Project members**.
- It never displays **Private**, **Only you**, or a lock.

The creator field is attribution data. It does not become ownership.

## Slice 2: Stable access record

Add a session access row keyed by `(project_id, session_id)`:

```text
session_access
  project_id
  session_id
  owner_user_id nullable
  audience personal | project
  custody active | frozen
  revision integer
  created_at / created_by_id
  updated_at / updated_by_id
```

The separate row is necessary because current session deletion removes stream state while records
and traces remain. The authorization record must outlive every derived object.

Invariants:

- `personal` requires an active owner unless custody is `frozen`.
- `frozen` denies normal content access and mutation until a later recovery policy exists.
- Triggered and operational sessions use `project`.
- Existing sessions use `project`.
- `created_by_id` remains historical attribution. `owner_user_id` is authority.
- Audience mutations compare and increment `revision`.

### Atomic creation

Reserve a server-issued session ID and create `session_access` before the first runtime write. Every
command, heartbeat, trigger, or import path must resolve an existing access row or atomically create
one under the unique `(project_id, session_id)` constraint. A conflicting first touch fails; it does
not adopt the existing owner.

Rollout uses dual-write before backfill. Backfill the union of stream, record, turn, interaction,
attachment/file, mount, and trace session IDs as Project audience. During migration, missing access
rows are logged and treated as Project-visible only behind a temporary compatibility switch. After
coverage reaches the agreed threshold, remove the switch and fail closed.

## Slice 3: Enforcement

One `SessionAccessService` computes effective access:

```text
can_view = active Project membership
           AND view_sessions
           AND custody_is_active
           AND (is_owner OR audience_is_project OR active_view_grant)

can_manage = active Project membership
             AND custody_is_active
             AND is_owner
             AND required lifecycle capability
```

RFC 2 adds `active_view_grant`. Audience access never grants Project administration, deployment,
secret reveal, or Organization authority.

### Relationship resolvers

Every derived domain must resolve to the authoritative session before it returns content, creates a
signed URL, computes analytics, or emits an event:

| Domain | Required relationship |
| --- | --- |
| Streams, records, turns, interactions, attachments | Native `(project_id, session_id)` |
| Session mounts and files | Trusted mount-to-session relationship |
| Generic mount/file routes | Resolve explicit provenance first; session-derived data delegates to session access |
| Traces and spans | Persist a trusted trace-to-session mapping at ingest; child spans inherit root mapping |
| Event streams | Filter or route frames by caller-visible session IDs |

Every potentially derived object records explicit provenance as Project data or session data. The
system never infers Project visibility from a missing session relationship. Missing, unclassified,
or inconsistent provenance denies access after migration. Lists, counts, search, analytics, direct
IDs, downloads, exports, signed URLs, and event streams use the same resolver.

Private-session traces inherit the session audience. A trace is Project-visible only when ingest
explicitly classifies it as operational Project data. Unclassified traces are quarantined or denied
before personal sessions are enabled.

### Event-stream revocation

Bind a session event subscription to the access `revision`. Audience, membership, or policy changes
close affected streams. Periodic reauthorization provides a bounded fallback. Shared Project event
channels must not emit personal session identifiers to unauthorized subscribers.

## Interface roles

Keep response concepts separate:

- **Attribution:** `created_by_id`.
- **Ownership metadata:** `owner_user_id`.
- **Stored policy:** `audience` and `revision`.
- **Caller authorization:** computed effective role and allowed actions.

List rows do not carry grant lists. RFC 2 exposes People with access through a session-nested
endpoint.

## Owner departure

Project sessions remain Project-visible. Personal sessions become `frozen`; they never widen to
Project access. The first release does not support administrator transfer or content inspection.
That avoids introducing an unreviewed break-glass path.

## Verification

- **My sessions** filters manual origin and creator before count and pagination.
- Creator stamping covers command, rename, heartbeat, trigger, and personal API-key paths.
- Access creation is atomic and conflicting first touches fail.
- Backfill includes session IDs present only in derived domains.
- An endpoint-to-relationship test matrix covers every list, direct ID, download, export, signed
  URL, analytics, and event path.
- Private traces, files, interactions, and event frames do not leak.
- Existing sessions remain Project-visible.
- Personal sessions show **Only you** only after compatibility fallback is removed.

## Rollout

1. Ship **My sessions** with server query pushdown.
2. Dual-write access rows as Project audience.
3. Backfill all known session IDs and measure missing relationships.
4. Enforce access while every session remains Project-visible.
5. Remove the missing-row compatibility switch and fail closed.
6. Enable personal entry points behind a product flag.
7. Validate defaults before broad rollout.
