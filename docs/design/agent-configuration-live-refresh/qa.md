# QA plan

The tests prove three independent properties: commits stay non-blocking, private state does
not leak, and supported facets install correctly without corrupting unsupported state.

## API commit metadata

- A successful `commit_revision` returns one `configuration_committed` control event with
  exact variant ID, revision ID, stored string version, and verified integer sequence.
- `no_change`, conflict, validation refusal, access refusal, and failed commit return none.
- Failure in post-commit notification code cannot turn a durable commit into a reported
  failure.
- Control metadata is a sibling of model-visible content and never appears inside it.
- Existing public committed-revision UI behavior remains unchanged.

## Runner callback intake

- Control events are accepted only for the authenticated reserved commit operation.
- A gateway, workflow, client, or arbitrary callback cannot fabricate one.
- Malformed source identity is ignored and logged without exposing callback content.
- The runner records the highest announced sequence before emitting the private record.
- Forwarding the normal tool result does not await private event delivery.

## Private stream

- `kind: control` is consumed by `AgentStream` and never yielded as a public `Event`.
- A runner emits control records only when `/run` advertises
  `configuration-control-v1`; absent and unknown tokens emit none.
- It traverses private runner-to-service NDJSON but never enters public Vercel, SSE, NDJSON,
  session persistence, or trace content.
- An accepted control record is enqueued before its public tool result and before any
  terminal result record.
- A slow or failing service handler does not delay or fail the public stream.
- Duplicate event IDs schedule at most one resolution attempt per service process.
- Service shutdown cancels background work without changing the commit result.

## Complete resolution

- Initial and refresh paths produce equal snapshots for the same exact revision.
- Initial `/run` projects facet values to existing fields, carries only digests and provenance
  in `configurationState`, and initializes desired, trusted installed, observed, and local
  credential-epoch state as contracted.
- The runner recomputes every facet digest and rejects a mismatched digest before mutation.
- A delayed worker for revision N still retrieves N after N+1 becomes head.
- A mismatched returned variant, revision, version, or sequence is rejected.
- Decimal versions `"9"` and `"10"` order by verified sequence, never lexical comparison.
- Non-decimal and unsafe-integer versions do not produce a refresh control event.
- A refresh that started from draft parameters resolves the exact committed revision as its
  desired source instead of merging the prior draft into it.
- An initial run from unsaved parameters uses inline source provenance and still shares the
  same resolved facet serializer.
- Tool, gateway, MCP, model connection, skills, embeds, harness, and permissions use the
  same resolution code in both paths.
- Gateway resolution carries API-produced opaque provider-account and versioned-action
  bindings from `/tools/resolve` into the private execution facet.
- Messages, trace identity, run context, interaction state, and effective replay parameters
  do not enter the snapshot.
- Secret values do not enter fingerprints, logs, traces, or apply responses.
- Inline fingerprints use canonical normalized `parameters.agent` with declared credential
  values replaced by stable bindings or the fixed literal-credential marker; equal normalized
  inputs hash equally and literal secret bytes never enter the hash.
- Unknown credential containers and unknown fields are rejected without value or raw-body
  logging.

## Active-run targeting

- The configured control router sends the opaque owner target to the replica that emitted it.
- The service never follows a URL supplied in a control record.
- Wrong authenticated project principal, active run, optional session or turn, owner, event,
  token, or revision is rejected.
- Session and non-session HTTP runs both receive an `activeRunId`.
- Expired credentials and ended turns return `stale_target`.
- Oversized and unknown-schema snapshots are rejected before mutation.
- Every stable snapshot accepted by `/run` fits the dedicated apply-body limit.
- An apply snapshot with `source.kind: inline` is rejected before mutation.
- A source variant different from the active run's bound variant is rejected.
- Subprocess transport reports unsupported without exposing a callback.
- Registry cleanup runs after success, failure, cancellation, pause, and teardown.

## Ordering and idempotency

- Duplicate event and snapshot delivery is idempotent.
- Snapshot N cannot install after N+1 was announced.
- A late completion from attempt N cannot overwrite attempt N+1.
- Failure to resolve N+1 does not permit delayed N to install.
- One active run accepts only its bound variant and maintains one sequence watermark.

## Facet application

- Independent groups can succeed and fail in one snapshot.
- Failure during preparation mutates no value in that group.
- Failure during adapter application leaves installed state unchanged or marks the group
  `dirty` when external state may have changed.
- Unsupported facets remain byte-identical.
- A validated snapshot advances desired state for unsupported facets; a resolution failure
  advances only the announced ordering watermark.
- Successful groups record exact last-known-installed source, digest, and local credential
  epoch with `installedTrusted: true`.
- A dirty result preserves last-known-installed diagnostics but sets
  `installedTrusted: false`.
- Dirty state can never return `unchanged`; an equal desired generation retries
  reconciliation.
- Optional consumer observation echoes only a runner-issued pending token; the runner derives
  observed digest and source from its own installed map.
- Partial success never stamps the complete snapshot fingerprint as fully installed.
- A topology mismatch makes every harness-dependent group unsupported.
- A stale runner-owned compare-and-swap cannot publish after a newer sequence. A stale
  external adapter attempt cannot commit externally visible mutation with an expired token.
- A config change and the credential material it consumes publish together or not at all;
  the runner derives the comparison epoch during publication.
- A tools update received during a turn reports `pending`, survives active-target cleanup in
  a retained environment, is superseded by a newer sequence, and applies before the next turn.
- Ephemeral-environment teardown discards pending work and the next run resolves normally.
- Changed tool permission, credential binding, dispatch, or execution semantics install an
  immediate deny-only overlay and invalidate pending approvals until reconciliation succeeds.

## Gateway execution

- A call started before policy publication keeps one capture for filtering and planning but
  must recheck the current generation before authenticated API callback dispatch.
- The next call after publication uses the new capture throughout.
- Search memory clears when gateway generation changes.
- Add, remove, connection switch, default change, and per-tool override install atomically.
- Removing the last connection denies later execution despite stale model-visible tools.
- Adding the first connection may preinstall private gateway execution, but reports tools
  unsupported or pending and blocks calls until matching generic descriptors install.
- A malformed refreshed policy fails strict normalization and leaves the prior group.
- An approval created under an old execution generation cannot authorize changed routing or
  permission under a new generation.
- Tightening permission or invalidating a binding while approval is parked invalidates it;
  resume and callback dispatch compare with the currently installed composite generation.
- An authenticated API callback dispatched before publication may finish; no older call that
  has not yet dispatched its callback may cross the new fail-closed boundary.
- The same generation check holds after durable approval persistence and cold-session resume.
- Cold resume resolves the bound variant's current committed head before decision lookup;
  replayed old effective parameters cannot reestablish an obsolete generation.
- Reconnecting the same slug to another provider account changes the opaque connection
  binding and invalidates the old approval.
- Remapping the same tool key to another provider action changes the opaque execution binding
  and is rejected by final API execution under the old generation.
- Changing a generic gateway dispatch descriptor changes the composite gateway call
  generation and invalidates an old approval even when gateway policy is unchanged.
- Final API verification selects connection, credentials, and canonical action from one
  immutable/versioned resource snapshot so reconnect cannot race between check and use.

## No model activity

Across every success and failure case, assert that refresh creates none of these:

- user message;
- assistant message;
- synthetic continuation;
- model invocation;
- harness prompt;
- automatic session reopen.

## Live cells

### Same-run gateway update

Use an agent that already has one gateway connection. In one active run, have it commit a
second integration and later search for a tool from it. Verify:

- commit latency does not include refresh resolution;
- no extra message or invocation appears;
- the private snapshot identifies the exact committed revision;
- a gateway call made after installation uses the new integration;
- provider execution uses the resolved connection from that revision.

Run this cell on Pi, Claude Code, and Codex because the supported facet is runner-owned.

### Immediate-call race

Delay service resolution, then call `search_tools` immediately after commit. Verify the
call can use the prior policy and the platform does not block it. Release the delay and
verify a later call uses the new policy.

### Partial best effort

Commit one revision that changes gateway policy, workspace files, and MCP configuration.
Verify gateway policy installs, the initially unsupported workspace and harness-session
groups remain on their prior installed versions, and no model activity is created.

### Lost refresh recovery

End the active run before snapshot delivery. Verify `stale_target`, then start a normal run
from the committed revision and verify full run-start resolution uses it.
