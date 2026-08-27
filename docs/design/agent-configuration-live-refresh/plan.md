# Implementation plan

Each slice can merge with its behavior disabled or limited to the capability it proves. The
first four slices build the general transport and state model. The fifth enables gateway
policy as the first live facet.

## Slice 1: shared complete configuration resolution

Extract the run-start composition from `make_agent_handler()` into one typed resolver.

Work:

- Define `ResolvedAgentConfiguration` and `ResolvedRunConfigSnapshot` Python models.
- Give snapshots committed or inline source provenance so unsaved draft runs remain
  representable; permit only committed sources on asynchronous apply.
- Separate stable resolved configuration from the per-turn invocation envelope.
- Keep callback delivery and current telemetry authorization in the invocation envelope.
- Make initial `/run` serialization consume the snapshot.
- Project snapshot values to existing `/run` fields, add secret-free `configurationState`,
  and initialize runner facet state from it.
- Resolve exact revision references through the existing workflows API path.
- Preserve vault, embed, tool, gateway, MCP, model connection, harness, and capability
  resolution.
- Separate credential values from secret-free configuration fingerprints.
- Canonically hash each strict facet config and require runner recomputation before use.
- Extend redaction coverage to every credential-bearing snapshot field.
- Reject secret-bearing values outside the schema's declared credential containers.

Exit proof:

- Existing `/run` golden payloads remain byte-equivalent where the contract did not change.
- Resolving one exact revision through initial and refresh entry points produces equal
  snapshots.
- No asynchronous refresh behavior exists yet.

## Slice 2: private commit notification

Add private commit metadata from API callback to service without changing model-visible
events.

Work:

- Extend `ToolCallResponse` with typed private `control_events`.
- Emit `configuration_committed` only after a successful durable commit.
- Isolate existing cache invalidation and public event emission so their failure cannot turn
  a durable commit into a failed tool result.
- Parse it only on the trusted reserved `commit_revision` callback path.
- Add `kind: control` to runner `StreamRecord`.
- Advertise `configuration-control-v1` on the internal HTTP `/run`; emit the private union
  arm only when advertised.
- Add a dedicated control emitter outside public event persistence and tracing.
- Consume control records in `AgentStream` without yielding a public event.
- Install a service handler that schedules background work and contains failures.

Exit proof:

- Commit latency and model-visible content are unchanged.
- A private record traverses only runner-to-service NDJSON. It never reaches public Vercel,
  SSE, NDJSON, session history, or traces.
- Failed and `no_change` commits emit no control record.

## Slice 3: active-run callback transport

Deliver snapshots to the runner process that owns the active run.

Work:

- Mint an `activeRunId` for every HTTP run, including runs without session identity.
- Add a process-local active-run registry keyed by that ID.
- Mint short-lived apply-only callback credentials for active HTTP runs.
- Emit an opaque owner target in the private record. Never emit a destination URL.
- Add or configure trusted owner routing from the service runner client to one runner
  replica. Treat this as a rollout blocker, not an assumed existing capability.
- Add the authenticated configuration apply endpoint.
- Validate project, session, turn, event, revision, expiry, schema, and body size.
- Bind each active run to one variant and reject cross-variant events or snapshots.
- Serialize application per active run.
- Clean registry entries and credentials on every terminal path.
- Report subprocess transport as unsupported.

Exit proof:

- A callback reaches the owning replica through the configured control router in a
  multi-replica test.
- Wrong, expired, ended, or cross-run targets change no state.
- Duplicate delivery is idempotent.
- The endpoint accepts snapshots but reports all facets unsupported.

## Slice 4: asynchronous facet state

Represent partial best-effort convergence without advancing a false whole fingerprint.

Work:

- Define the facet and dependency-group registry.
- Track the announced ordering watermark separately from desired, last-known-installed,
  installed-trust, optional observed, failed, and unsupported state per facet.
- Keep existing `AppliedEnvironmentState` as the observed state used by normal warm-session
  reconciliation. Do not stamp its whole fingerprint after partial asynchronous installation.
- Record the highest announced sequence before dispatching refresh work.
- Reject stale snapshots and stale asynchronous completions.
- Publish runner-owned state with compare-and-swap against the atomic announced sequence.
- Require external adapters to condition their externally visible commit on a runner-issued
  attempt token still being current.
- Separately require atomic publication, rollback, or honest `dirty` reporting for partial
  external mutation.
- Continue independent groups after one group fails.
- Store the newest lifecycle-deferred snapshot in environment reconciliation state, preserve
  it across active-target cleanup, and supersede it by sequence.
- Derive credential epochs runner-side and keep them outside wire values and secret-free
  facet digests.
- Add aggregate metrics without configuration values.

Exit proof:

- Partial success records exact per-facet provenance and process-local credential epochs.
- A failed group leaves all of its facets unchanged, or marks them `dirty` when an external
  adapter may have mutated.
- A late sequence cannot roll state backward.
- A later ordinary `/run` can compare against partial installed state.

## Slice 5: gateway execution policy

Enable the first runner-owned live group.

Work:

- Replace the once-per-turn gateway policy value with an atomic normalized cell.
- Extend the strict gateway policy wire DTO with provider-account and versioned-action
  bindings from `/tools/resolve`.
- Capture one immutable gateway generation per call.
- Publish policy, connection routing, search filtering, and approval generation together.
- Extend gateway resolution with opaque provider connection and action bindings.
- Clear gateway search memory after a successful swap.
- Define a secret-free gateway execution generation and bind it to approval keys, persisted
  interaction metadata, resume lookup, and final execution checks.
- Compose it with the shared tools generation for gateway approval identity.
- Install the deny-only safety overlay for changed tool permissions, credential bindings,
  dispatch, or execution semantics before gateway refresh is enabled; invalidate affected
  pending approvals while full tools reconciliation remains pending or unsupported.
- On approval resume and callback dispatch, compare the capture with the currently installed
  composite generation and invalidate stale parked approvals.
- Carry opaque execution bindings in private callback context and verify them in the API
  while selecting connection, credentials, and canonical action from one immutable/versioned
  resource snapshot immediately before provider execution.
- On cold approval resume, resolve the bound variant's current committed head before durable
  decision lookup; never use replayed effective parameters as current-generation authority.
- Handle first connection, last connection, addition, removal, connection switch, and
  catalog drift as defined in [facet-matrix.md](facet-matrix.md).

Exit proof:

- A commit result returns without waiting.
- A later same-run gateway call uses the new policy after installation.
- An authenticated API callback dispatched before installation may finish under the old
  generation; a merely started or parked call must pass the current generation before
  callback dispatch.
- A first connection is not falsely reported as model-visible.
- Removing the last connection revokes execution even if the harness still shows the
  generic tool.

## Slice 6: file installation

Install complete managed workspace file groups only after the environment supports a
generation-fenced replacement or honest dirty-state reporting. Opaque harness permission
files remain unsupported until their security contract permits live replacement.

Work:

- Build complete desired file sets, including deletions.
- Add an atomic managed-set replacement mechanism, or return `dirty` if the provider can
  partially mutate before failure.
- Record installed state after replacement succeeds.
- Record harness observation separately when an adapter supplies it.
- Do not reopen a harness or create model activity after installation.

Exit proof:

- Add, replace, and delete produce the exact committed managed file set.
- Failure before publication leaves the previous installed set; possible partial provider
  mutation records `dirty`.
- The refresh does not claim the harness observed the files without evidence.

## Slice 7: additional facets

Enable model, tool catalog, MCP, runtime, and credential groups one at a time. Each facet
requires an adapter-specific application mechanism and tests. Unsupported remains a valid
result until then.

The tool catalog first requires implementing the planned `ToolCatalogManifest` and
`ToolExecutionPlan` split so model-visible tools and private execution bindings cannot
disagree accidentally. Those two facets remain one atomic tools dependency group and share
one generation. Catalog changes install only between turns and never while an approval is
suspended. The execution plan aggregates stable snapshot descriptors with callback delivery
from the current invocation envelope. Slice 5 has already installed the required fail-closed
overlay; this slice adds full live convergence rather than the safety boundary.

## Rollout

1. Ship slices 1 through 4 with facet installation disabled.
2. Observe private event delivery, resolution latency, stale-target rate, and replica routing.
3. Enable gateway installation behind an operator flag for internal projects.
4. Run the gateway live cells across Pi, Claude Code, and Codex.
5. Expand rollout while retaining a kill switch for asynchronous apply.
6. Enable later facets separately after their own proof.

## Metrics

Record counts and latency for:

- committed configuration events;
- private events consumed;
- exact revision retrieval and resolution;
- stale and duplicate snapshots;
- stale targets and wrong-replica attempts;
- installation outcomes by facet and harness;
- time from commit response to facet installation;
- redaction or credential validation refusal;
- gateway calls by captured policy generation.

Metrics contain IDs, versions, facet names, status codes, and durations. They contain no
authored configuration, tool arguments, connection slugs, or credential values.
