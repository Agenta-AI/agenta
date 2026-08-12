# Data model options

## Required information

A durable fork needs to answer four questions:

1. Which session is the child?
2. Which session is its direct parent?
3. How many complete turns from the parent's effective transcript does the child inherit?
4. Which root session groups the complete branch family?

The first durable model does not need a record-level parent pointer. Rewind and rerun happen at turn
boundaries. To rerun a selected turn, the child inherits through the previous complete turn and
writes the copied or edited user prompt as its own first turn.

The canonical cursor is an effective-turn count rather than a turn ID. Hydrated `UIMessage` objects
do not currently retain `turn_id`, old records may have a null `turn_id`, and a child can be forked
from a turn it already inherited from an ancestor. The visible transcript always has a stable
ordered turn count, so the frontend can supply it without guessing a database identifier.

## Recommended durable model: session lineage

Add one row for every non-root branch:

```text
session_lineage

project_id             UUID, required
session_id             string, required, child session
root_session_id        string, required
parent_session_id      string, required
inherited_turn_count   integer, required, minimum 0
cutoff_session_id      string, nullable, internal physical cursor
cutoff_record_id       UUID, nullable, internal physical cursor
created_at             timestamp, required
created_by_id          UUID, nullable by existing lifecycle conventions
```

Recommended constraints and indexes:

```text
PRIMARY KEY (project_id, session_id)
INDEX (project_id, root_session_id)
INDEX (project_id, parent_session_id)
```

`inherited_turn_count = 0` means the child inherits no completed parent turn. This represents a
fork before the first turn.

The service validates that the parent effective transcript contains at least the requested number
of complete turns. Session IDs remain bare string correlators because sessions may be external and
the current model does not enforce session IDs as foreign keys.

`inherited_turn_count` is the semantic cursor exposed to clients. At fork creation, the backend
also resolves the final inherited record and stores its real source session and record ID. Those two
internal fields let the records database stop at the inherited boundary instead of loading a large
discarded parent tail. Both are null when the inherited turn count is zero.

The cutoff record ID is not itself an ordering key. The records DAO resolves that row and applies a
null-safe total order:

```text
(timestamp IS NULL, COALESCE(timestamp, created_at), created_at,
 COALESCE(record_index, -1), record_id)
```

The leading boolean preserves `timestamp ASC NULLS LAST`. `COALESCE(timestamp, created_at)` gives
the null-timestamp group a comparable value, after which `created_at` and `record_index` preserve
their current precedence. Non-null `record_id` is the deterministic tiebreaker. The tracing database
needs a matching composite expression index prefixed by `project_id` and `session_id`. Normal
records reads and cutoff reads must use the same order. The source session is stored because the
last inherited record may belong to an ancestor rather than the direct parent.

### Example

```text
Session A turns: A1, A2, A3

Lineage for B:
session_id = B
root_session_id = A
parent_session_id = A
inherited_turn_count = 2
cutoff_session_id = A
cutoff_record_id = <last record of A2>

Session B turns: B1, B2

Effective transcript for B:
A1 + A2 + B1 + B2
```

If C forks from B through B1:

```text
Lineage for C:
session_id = C
root_session_id = A
parent_session_id = B
inherited_turn_count = 3
cutoff_session_id = B
cutoff_record_id = <last record of B1>

Effective transcript for C:
A1 + A2 + B1 + C's turns
```

The count is over B's effective transcript, not only turns physically written under B. This allows
a child to fork at an inherited ancestor turn without adding another cursor type.

Lineage traversal combines the physical cutoff on each ancestry edge into a bounded segment plan.
For the example above, C reads A only through A2 and B only through B1. It never scans A3 or later B
turns merely to discard them in application code.

## Why lineage is not stored in tags or general metadata

Tags describe filterable labels such as session origin. General metadata holds optional extension
data. Lineage changes transcript reconstruction and must be validated, indexed, and queried as a
core relationship. A dedicated table gives it a typed lifecycle and prevents unrelated metadata
writes from replacing it.

Using `session_streams.meta` is acceptable for a disposable spike, but not for the production read
path.

## Option comparison

### Option A: frontend-only copied prefix

This is pull request 5860.

```text
Child local messages = retained parent messages
Child durable records = new turns only
```

Advantages:

- No backend work.
- No migration.
- No extra rewind request.
- Smallest fix for the original resurrection bug.

Costs:

- Not cross-device.
- Local storage loss removes inherited context from the visible transcript.
- Requires special first-request replay state.
- Duplicates the prefix in browser storage.

Use this only as the immediate bug fix.

### Option B: copy parent records into the child

The backend could physically duplicate every inherited record under the child session ID.

Advantages:

- Existing records queries and runner reconstruction need little change.
- A child is self-contained.

Costs:

- Fork writes grow with transcript length.
- Every branch duplicates records and large event attributes.
- Record identity, trace identity, tool-call identity, and attachment provenance become ambiguous.
- A large branch family multiplies storage.
- Copying while the parent is running needs snapshot rules.

This option is not recommended.

### Option C: session lineage with read-time transcript resolution

The child stores only new turns. One lineage row points to the inherited parent prefix.

Advantages:

- Records stay immutable and append-only.
- Fork creation is constant-size.
- No record duplication.
- The relationship supports a branch tree naturally.
- Parent and child provenance remain visible.

Costs:

- Transcript reads must resolve ancestry.
- The runner and frontend must use the effective transcript endpoint.
- Attachments and session files need an explicit inheritance policy.
- Deep branch chains need a depth limit and cycle protection.

This is the recommended durable model.

### Option D: parent pointers on messages or records

LobeChat and Open WebUI store message trees because their durable unit is a message. Agenta's
durable unit is a lower-level event record. A single assistant message may span many records.

Adding `parent_record_id` would force message semantics into event fragments and would still not
solve native runner continuity. A new first-class message table could support true message trees,
but it is a larger redesign than session branching requires.

Do not choose this option for rewind.

### Option E: truncate or supersede records in place

Records already carry lifecycle fields, so the API could hide later records. The runner would also
need to invalidate its warm pool, discard native harness continuity, and start from the retained
prefix. This destroys or hides the old branch unless a second lineage model preserves it.

This option is harder than a fork and gives users less recoverability. It is not recommended.

## Header and related data

The fork operation should copy or derive:

- `name`: copy a user-defined name and append `(branch)`; auto-generated naming may be recalculated.
- `description`: copy unchanged by default.
- workflow references: the child turn supplies these through the normal invocation path.
- native `agent_session_id`: never copy; the child must establish separate harness continuity.
- liveness flags: start false.
- archive and ended state: do not copy.

## Attachments, files, and side effects

### Attachments

Inherited messages may contain session-scoped attachment IDs. The current `session_attachments` row
is the owner and has one `session_id`; its `referenced_at` field is only a timestamp, not a reusable
reference relation.

The recommended model adds an access table:

```text
session_attachment_access

project_id
session_id             child allowed to use the attachment
attachment_id          existing parent-owned attachment
source_session_id      owning parent session
created_at
```

The fork transaction inserts access rows for attachments reachable from the inherited prefix. Read
and reference APIs accept either direct ownership or an access row. File bytes and attachment IDs
remain unchanged.

### Session files and sandbox state

A transcript branch does not automatically clone files created in the parent sandbox. The first
durable version should state that it inherits conversation context and attachment access, not
arbitrary filesystem or process state. Sandbox snapshotting is a separate capability.

### External tool side effects

Forking never undoes sent emails, commits, API mutations, or other external actions. The existing
warning for side-effecting tools remains required.
