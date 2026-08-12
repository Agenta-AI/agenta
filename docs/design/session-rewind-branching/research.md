# Current implementation and failure analysis

## Current storage layers

Agenta stores session information at three levels.

### Session stream

`session_streams` has one row per session and project. It stores:

- `session_id`
- `name` and `description`
- liveness flags
- the current `turn_id`
- tags and general metadata
- lifecycle timestamps

Relevant code:

- `api/oss/src/dbs/postgres/sessions/streams/dbes.py`
- `api/oss/src/core/sessions/streams/dtos.py`

### Session turn

`session_turns` has one row per execution. Its unique ordering key is
`(project_id, session_id, turn_index)`. It also stores the harness kind, native agent session ID,
sandbox ID, workflow references, and trace identifiers.

Relevant code:

- `api/oss/src/dbs/postgres/sessions/turns/dbes.py`
- `api/oss/src/dbs/postgres/sessions/turns/dbas.py`
- `api/oss/src/core/sessions/turns/dtos.py`

### Session record

`records` stores append-only events. A record has `session_id`, `turn_id`, `record_index`, event
time, source, type, and opaque event attributes. `record_index` restarts for each turn, so reads
order first by producer timestamp, then ingest time, then record index.

Relevant code:

- `api/oss/src/dbs/postgres/sessions/records/dbes.py`
- `api/oss/src/dbs/postgres/sessions/records/dbas.py`
- `api/oss/src/dbs/postgres/sessions/records/dao.py`

Records are event fragments, not message rows. Assistant text, tool calls, tool results, and finish
events may all be separate records inside one turn. This is why adding `parent_record_id` to every
record would model the wrong abstraction for session branching.

## How the browser loads a transcript

`loadSessionMessages(sessionId)` performs one logical records fetch through the shared TanStack
Query cache. The cache is persisted to IndexedDB and revalidated when stale. The returned records
are folded into Vercel `UIMessage` objects by `transcriptToMessages`.

The browser keeps a second transcript cache in local storage. On mount:

- A local cache hit paints immediately and starts one background records revalidation.
- A local cache miss performs one records query and shows a skeleton until it resolves.
- A brand-new session skips the guaranteed-empty records query.

Relevant code:

- `web/oss/src/components/AgentChatSlice/assets/loadSession.ts`
- `web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.ts`
- `web/packages/agenta-entities/src/session/state/records.ts`

## How the runner reconstructs context

The runner fetches `/sessions/records/query` using only the current session ID. It folds those
ordered records into neutral chat messages. This lets the browser send only the newest user message
for an established session.

Relevant code:

- `services/runner/src/sessions/records-query.ts`
- `services/runner/src/sessions/reconstruct.ts`
- `services/runner/src/sessions/persist.ts`

The current query cannot inherit records from another session because it accepts only `session_id`.

## What pull request 5860 adds

The pull request adds `rewindForkAtomFamily` in the OSS playground:

1. Mint a new session ID through the existing `addSessionAtomFamily` writer.
2. Copy the retained `UIMessage[]` prefix into the new session's local message cache.
3. Mark the new session in the module-level `unloggedHistorySessionIds` set.
4. Optionally save an editable draft or schedule an automatic assistant rerun.
5. Close the original tab without deleting the original session.
6. Send the complete local transcript on the fork's first request.
7. Clear the replay marker in `onFinish`.

The pull request does not modify the API, database, or runner record reconstruction.

## What works

- The original session remains complete in local and server History.
- The new session gets a different native runner continuity identity.
- Same-browser hydration under the old session ID can no longer resurrect the removed tail.
- The first branch request can provide the retained context to an empty runner session.
- User-side rewind restores the selected user text to the composer.
- Assistant-side rewind automatically reruns the preceding user turn.
- Existing side-effect warnings remain in place.

## What does not work

### Reload before first send loses replay intent

`unloggedHistorySessionIds` is a module-level `Set`. The retained messages survive in local storage,
but the instruction to replay them does not. After reload, last-message-only optimization sends the
new prompt without the retained prefix.

The same reload also loses the action that created the fork. User-side rewind stores the editable
draft in `composerDraftBySession`, an in-memory `Map`. Assistant-side rewind stores its automatic
rerun request in `pendingRewindRerunAtom`, an in-memory atom. A correct reload-safe fix must persist
the complete bootstrap, not only the replay boolean.

### Failed or aborted first request consumes replay intent

The pull request clears the marker in `onFinish` without inspecting the AI SDK completion flags.
The callback also runs for abort, disconnect, and error outcomes. A retry can therefore omit the
retained prefix even though runner continuity was never established.

### The retained prefix is not durable under the child session

The runner persists the new inbound user turn and new agent events under the child session. It does
not copy the retained parent records. The prefix remains only in this browser's local message cache.

After local storage loss or on another device, opening the child shows only records written directly
under the child. The agent response may refer to context the UI cannot display.

### A custom title is not copied

The new session is created as `{id, createdAt}`. Auto-title later derives a title from the first
retained user message. A user-defined title is lost. The frontend session model also omits the
backend's existing description field.

### The hydration test protects the local cache rather than durability

The new `shouldAdoptServerTranscript` test correctly prevents a shorter child record log from
overwriting a longer local transcript. That preserves same-browser display. It does not make the
prefix available to another browser or the runner's future server reconstruction.

### The package copy still rewinds in place

`web/packages/agenta-chat/src/hooks/useAgentConversation.ts` still truncates user-side rewind under
the same session and regenerates assistant-side rewind under the same session. It is currently not
the shipped OSS playground path, but it must be resolved before that package surface is used.

## Why append-only records are not the problem

Append-only storage is compatible with branching. The missing concept is a read-time relationship:

```text
child session B inherits the first two effective turns of parent session A
```

Each session can keep writing a linear event log. A lineage-aware reader concatenates the permitted
prefixes. No existing record changes or deletion are required.
