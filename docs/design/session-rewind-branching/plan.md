# Implementation plan

## Recommended sequence

Do not combine frontend hardening, durable lineage, and branch-tree UI into one pull request. The
current production bug needs a small correction. Durable cross-device branches need backend design
and migration work. A grouped branch UI should follow only after the durable contract exists.

## Pull request 5860 changes requested before merge

### Persist the complete fork bootstrap

Replace `unloggedHistorySessionIds`, the rewind draft handoff, and the pending automatic rerun atom
with one local storage-backed bootstrap keyed by child session ID.

Reason:

- The retained messages already survive reload.
- Edit or rerun mode, restored draft, and the instruction to replay history must survive the same
  reload.
- User-side rewind has an unbounded edit window before the first request.

Implementation surfaces:

- `web/oss/src/components/AgentChatSlice/state/sessions.ts` or a focused persisted state module.
- `web/oss/src/components/AgentChatSlice/state/rewindFork.ts`.
- `web/oss/src/components/AgentChatSlice/hooks/useComposerDraft.ts`.
- `web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts`.
- Session deletion and reset cleanup paths.

### Clear replay state only after success

Read the pinned AI SDK completion flags. Keep the bootstrap after abort, disconnect, or error. Clear it
only when the runner has successfully completed the first child turn.

Reason:

- `onFinish` is a lifecycle callback, not a success guarantee.
- Clearing early turns a recoverable network failure into silent context loss.

### Preserve the source title

Let `addSessionAtomFamily` accept an optional title. `rewindForkAtomFamily` copies the current source
title with a `(branch)` suffix and persists it through the existing header API. Untitled sessions
continue through auto-title.

Reason:

- A user-defined session name is descriptive metadata and should survive duplication.
- Auto-title from the first retained prompt can discard a deliberate rename.

Description remains out of scope because the frontend session model does not currently carry it.

### Add regression tests

Add tests for:

- User rewind, restore persisted state and draft, then send the complete retained history.
- Assistant rewind, restore persisted state, then perform the automatic rerun once.
- Abort first child request, retry, and replay again.
- Error first child request, retry, and replay again.
- Successful first child request clears bootstrap state.
- Deleting or resetting a child removes bootstrap state.
- A custom title is copied with a branch suffix.
- The original session remains complete and in History.

### State the durability limitation

Update the pull request description and comments to say that the parent prefix remains browser-local
under the child ID. Do not describe the fork as cross-device durable.

Reason:

- The child record log begins with the newly sent turn.
- Another browser cannot reconstruct inherited parent turns.
- The hydration count floor preserves a local copy but does not create a server copy.

### Fix the client-tool replay defect separately

In both transcript mapper copies, replace any existing tool input with a defined interaction input.
Add the `{}` placeholder followed by authoritative payload regression test in both test suites.

Reason:

- ACP explicitly uses `{}` as a possible early placeholder.
- The interaction request carries the real form payload.
- This defect is independent of rewind and should not obscure the fork review.

## Verification for pull request 5860

Run the existing focused suites plus the new tests:

- AgentChatSlice unit tests.
- `@agenta/playground` request-builder unit tests.
- `@agenta/entities` transcript-adoption tests.
- TypeScript checks and frontend lint-fix required by repository guidance.

Manual scenarios:

1. Rewind a user turn, reload before sending, edit, and send.
2. Rewind an assistant turn and let the automatic rerun start.
3. Abort the first child run and retry.
4. Disconnect the network during the first child run and retry.
5. Open the original from History and confirm it is complete.
6. Rewind a custom-named session and inspect both History rows.
7. Confirm the side-effect warning still appears when required.

## Durable branching project

### Add the lineage domain

Create core DTOs, DAO interfaces, Postgres entities, mappings, and services for `session_lineage`.
Keep router, service, interface, implementation, and database layers in the repository's required
dependency order.

Acceptance conditions:

- One immutable lineage row per child session.
- Inherited-turn count validation against the parent's effective transcript.
- A physical source-session and record cutoff resolved at fork creation.
- Cycle and depth protection.
- Batched root and parent queries.
- No record copy.

### Add the fork endpoint

Create the child stream, lineage row, and attachment access rows through one composite DAO operation
that owns one core database transaction. Copy source header fields unless the caller overrides them.
Make target session ID reuse idempotent for an identical request.

Acceptance conditions:

- Repeated identical request returns the same child.
- Conflicting target reuse returns a domain conflict.
- A missing or foreign-project source is not exposed.
- An inherited-turn count beyond the source effective transcript is rejected.

### Add effective transcript resolution

Resolve the ancestor chain and fetch every physical record segment in order. Preserve each record's
source session ID. Keep the physical records endpoint's session-local semantics unchanged.

First make physical record ordering total and indexable. Add `record_id` as the final tiebreaker,
normalize nullable ordering fields as specified in `data-model.md`, and create the matching tracing
database expression index. Use the identical ordering for physical and effective transcript reads.

Acceptance conditions:

- Root transcript equals the current records transcript.
- Child transcript contains only the permitted parent prefix plus child records.
- Grandchild traversal works.
- Depth does not create one database query per ancestor.
- Parent records after the cutoff never appear.
- A two-turn fork from a large parent does not scan the discarded parent tail.
- Equal or null ordering fields cannot move a record across the inclusive cutoff.

### Switch runner reconstruction

Change the runner from physical records query to effective transcript query. A child starts a new
native harness session but receives inherited conversation context from the server.

Acceptance conditions:

- The frontend sends only the new user message.
- The runner sees inherited context before the first child turn.
- Native `agent_session_id` is new for the child.
- Warm and cold child turns agree.

### Switch frontend hydration

Add a transcript query state family and change `loadSessionMessages` to use it. Keep one shared
network flight and IndexedDB persistence. Include optional lineage in session-list reconciliation.

Acceptance conditions:

- Another browser opens the complete child transcript.
- Clearing local storage does not remove inherited context.
- Session list still uses one frontend request.
- Opening a branch still uses one transcript request.

### Add attachment access and define deletion policy

Add `session_attachment_access` rows for attachments in the inherited prefix. Update attachment read
and reference authorization to accept direct ownership or child access. Retain soft-deleted
ancestor records while descendants depend on them. Do not claim sandbox filesystem inheritance.

### Remove the frontend bootstrap compatibility path

After every supported backend exposes effective transcripts, remove `replayHistory` and the
persisted bootstrap. Keep a short rollout window if frontend and backend versions can differ.

## Later branch navigation

Keep each branch as a separate History row initially. Add grouped navigation only when user research
shows that branch families need one sidebar entry.

Possible UI additions:

- `Branch of <title>` subtitle.
- `View original` action.
- Branch point label such as `Branched before Turn 3`.
- A branch switcher inside one conversation surface.

These additions consume lineage. They do not require record parent pointers or mutable history.
