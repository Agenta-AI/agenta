# Architecture

## Decision

A successful agent configuration commit emits a private asynchronous invalidation. The
agent service retrieves the exact complete revision, runs the same resolution pipeline as
an initial invocation, and sends one complete resolved configuration snapshot to the runner
that owns the active run. The runner installs each supported atomic facet independently.

The commit result does not wait for this work. The refresh does not create model activity.

## Complete flow

```text
Model or harness
    |
    | commit_revision
    v
Runner tool relay
    |
    | POST /tools/call
    v
API commit handler
    |
    | stores exact revision R
    | returns normal tool result plus private committed-revision metadata
    v
Runner callback intake
    |
    +----> returns normal tool result to the harness immediately
    |
    +----> emits private StreamRecord(kind=control)
                |
                v
          Python AgentStream
                |
                | consumes record and schedules background work
                v
          Agent service refresh handler
                |
                | retrieves exact revision R
                | runs complete SDK/API resolution
                v
          ResolvedRunConfigSnapshot
                |
                | POST to runner-issued apply callback
                v
          Owning runner process
                |
                | validates target, order, and snapshot
                | installs supported atomic facets
                v
          Per-facet result and telemetry
```

## Component ownership

### API

The API owns durable revisions, project resources, and the commit transaction. After a
successful commit, it returns exact revision metadata beside the normal tool result. It does
not resolve the full runner configuration and does not apply runtime state.

The API emits no private event for `no_change`, refusal, validation failure, conflict, or
transport failure.

### Agent service and Python SDK

The service owns composition. It retrieves the exact revision and calls one shared SDK
resolution function used by both initial runs and refreshes. The resolver owns parsing,
reference hydration, tool resolution, policy compilation, MCP resolution, model connection
resolution, credential resolution, and harness adaptation.

The service consumes the private runner control record and starts refresh work in the
background. Resolution failure never fails or delays the public run stream.

The background task captures the authenticated project principal from the original service
invocation. It uses that principal to retrieve the revision and verifies that every control
record and resolved revision belongs to the same project. Runner-supplied routing fields are
never authorization.

### Runner

The runner detects trusted commit metadata on the existing API callback response. It adds
active-run target information, records the highest announced revision sequence, and emits a
private stream record.

The owning runner process validates the returned snapshot and applies supported facets. It
does not parse authored revisions, call the agent service, or duplicate SDK resolution.

### Harness adapter

An adapter may expose mechanisms for changing files, models, tool catalogs, MCP servers, or
other state. The runner invokes those mechanisms when available. The asynchronous refresh
does not wait for the harness to prove that a model noticed an installed value.

Adapters may return a runner-issued generation token as untrusted best-effort observation
evidence. The runner maps that token to its own installed state; an adapter never supplies
authoritative digest or source provenance. Lack of observation does not roll back a
successful installation.

## One configuration resolver

The current run handler performs composition inline. The first implementation change
extracts a typed resolver:

```python
async def resolve_agent_configuration(
    *,
    parameters: dict,
    composition: AgentComposition,
    context: RuntimeResolutionContext,
) -> ResolvedAgentConfiguration:
    ...
```

Initial invocation:

```text
resolve_agent_configuration(parameters)
    -> ResolvedRunConfigSnapshot with committed or inline source provenance
    -> project facet values to existing /run fields
    -> add secret-free configurationState
    -> combine with RunInvocationEnvelope
    -> POST /run
```

Commit refresh:

```text
retrieve exact committed revision
    -> normalize and hydrate parameters
    -> resolve_agent_configuration(parameters)
    -> ResolvedRunConfigSnapshot
    -> configured runner transport applies the opaque active-run target
```

The two paths share the resolver and snapshot serializer. Tests compare their snapshots for
the same exact revision.

An initial run built from unsaved parameters uses `source.kind: inline` with a secret-free
parameters fingerprint. A refresh always uses `source.kind: committed`. This lets the shared
snapshot represent current draft behavior without pretending that an immutable revision
produced it. After the runner validates a committed snapshot, its source becomes desired for
every facet, including unsupported facets.

## Non-blocking behavior

The runner forwards the normal `commit_revision` tool result as soon as the API call
succeeds. It enqueues any accepted private control record before the corresponding public
tool-result record and before a terminal `kind: result` record. Enqueue is local and does not
wait for service resolution. The service schedules its handler without awaiting resolution
in the stream iterator.

The design accepts this race:

```text
commit result reaches model
    -> model calls a tool immediately
    -> refresh has not installed yet
    -> tool call uses the prior installed generation
```

No component fences the tool call. A later call can use the new generation after it
installs.

## Complete snapshots, not patches

The commit event carries identity only. It never says "add Google Drive" or "replace the
instructions." The service retrieves the immutable revision and produces the complete
desired snapshot.

This permits duplicate, dropped, and reordered events. Any successful later refresh can
reconstruct desired state without replaying earlier events.

## Best-effort facet installation

The runner validates the entire snapshot before mutation, then computes changes against
per-facet installed state. It applies independent dependency groups separately.

For each group:

1. Prepare every changed value without mutating active state.
2. Recheck that the attempt still matches the atomic announced-sequence cell.
3. Invoke one generation-fenced adapter or runner-owned application mechanism. Runner-owned
   cells use compare-and-swap publication. External adapters receive an attempt token and
   must condition their externally visible commit on that token still being current.
4. Atomically publish the prepared group after successful application.
5. Record the installed generation for every facet in the group.
6. On failure before mutation, keep every facet in that group at its prior installed value.
7. If an adapter may have mutated before failure, mark the group `dirty`. Keep the last known
   installed generation only as untrusted diagnostics.

A failure in one group does not roll back successful independent groups.

An application mechanism that cannot fence a generation remains unsupported. A mechanism
that may partially mutate must additionally publish atomically, roll back, or report the
group `dirty`. A stale attempt ID can suppress stale bookkeeping, but it cannot undo an
external mutation, so bookkeeping alone is not a fence. The runner never holds its local
application lock across slow adapter I/O.

Topology is a dependency root. If the desired harness or sandbox topology differs from the
active topology and topology installation is unsupported, every harness-dependent group is
also unsupported for that snapshot. The runner must not apply Pi-adapted files or tools to an
active Claude runtime.

Tools are deferred while a turn runs or an approval is suspended. The environment, not the
active-run callback target, owns the latest pending tools snapshot. A newer sequence replaces
older pending work. A session-backed environment applies it after the current turn and before
the next; an ephemeral environment discards it at teardown. While work is pending, a
runner-owned fail-closed overlay blocks tools whose permission, credential binding, dispatch,
or execution semantics changed and invalidates their pending approvals. The overlay cannot
grant access.

## Installed and observed state

The runner records four distinct facts:

```text
announced:          the latest committed source learned by this run, for ordering
desired:            the value in the latest complete snapshot validated for this facet
last known installed: the value last installed successfully for this facet
observed:           an optional installed value the consumer supplied evidence of seeing
```

An announcement advances before background retrieval. If retrieval or resolution fails,
the announced watermark advances but desired facets do not. Validating a snapshot advances
desired state for supported and unsupported facets. A `dirty` result retains the last known
installed value for diagnostics but marks it untrusted; it does not claim that value remains
active.

Example after a partial best-effort refresh:

```json
{
  "announcedSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
  "facets": {
    "gatewayExecution": {
      "status": "installed",
      "desiredSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
      "lastKnownInstalledSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
      "installedTrusted": true
    },
    "harnessSession": {
      "status": "unsupported",
      "desiredSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
      "lastKnownInstalledSource": {"kind": "inline", "parametersFingerprint": "sha256:..."},
      "installedTrusted": true
    }
  }
}
```

Runner-owned facets are observed when installed because no harness state sits between the
runner and enforcement. Harness-owned observation is optional and never blocks the commit
or refresh.

The existing `AppliedEnvironmentState` remains the source for normal warm-session
reconciliation. An asynchronous installation does not advance its whole fingerprint. A
harness-owned facet advances observed applied state only when the governing adapter contract
permits it. A later normal `/run` therefore still reconciles an installed but unobserved file
change.

## Active-run targeting

The control record carries a runner-issued opaque target for the process that owns the
active run. It contains an `activeRunId` and owner routing handle. Separate delivery
credentials carry short-lived authorization. The service gives both to its configured runner
transport. It never follows a URL from the control record.

The credential is bound to:

- active run ID;
- authenticated project principal;
- optional session and turn identity when present;
- runner owner;
- expiration;
- apply permission only.

The runner removes the target when the turn or environment ends. Delivery to an expired
target returns `stale_target` and changes nothing.

Removing the active target does not remove environment-owned pending reconciliation. Pending
work either runs at the next safe boundary in a retained environment or is discarded with an
ephemeral environment.

## Ordering and duplicate delivery

The existing revision `version` remains a string. Private metadata also carries an integer
`sequence` parsed from and verified against the stored decimal version. Each active run is
bound to one variant. The runner rejects a commit event or snapshot for any other variant
and records the highest sequence announced for the bound variant before emitting the private
event.

- A snapshot below the highest announced sequence is stale and cannot install.
- A duplicate revision ID returns the prior result or an idempotent accepted result.
- Application is serialized per active run.
- A late completion carries an attempt ID and cannot overwrite a newer attempt.
- The sequence watermark is an atomic cell. Local publication uses a compare-and-swap against
  it; external adapters must enforce the same fence with their runner-issued attempt token.
- A failure to resolve sequence N+1 does not make an older sequence N eligible again.

## In-flight operations

An operation captures the installed generation of each runner-owned execution facet at its
start. It uses that capture until it ends. An atomic swap affects later operations only.

Permission tightening, credential revocation, and binding invalidation are fail-closed
exceptions. They immediately invalidate matching pending approvals. Before approval resume
or authenticated API callback dispatch, the runner requires the call's captured composite
generation to equal the currently installed composite generation and pass the current safety
overlay. Callback dispatch is the irreversible linearization point. A callback already sent
before publication may finish API validation and provider execution under its old capture.

A cold approval resume never treats replayed effective parameters as current authority. The
service retrieves and resolves the bound variant's current committed head under the captured
project principal, and the runner establishes that generation before decision lookup. If the
persisted approval's source and composite generation do not match, or current resolution
fails, resume refuses the approval. The immutable revision store is the durable authority; no
durable run-scoped configuration record is added.

Pending approvals bind to the execution generation under which the call was planned. If a
new execution generation changes the call's authorization or routing, the old approval
cannot authorize execution under the new generation.

Gateway approval binds a composite call generation made from the shared tool catalog
generation and a secret-free gateway execution generation. It is included in the approval
key, persisted approval interaction metadata, resume lookup, and final execution check.
Rotating credential bytes does not change the generation, but changing their connection or
action binding does.

The API resolution response supplies opaque execution bindings for the selected provider
connection and each catalog action. A connection binding commits to the actual provider
account instance, not only the local connection row. An action binding commits to the
canonical provider action definition and version, not only its stable key. The generation
includes those bindings. Final API execution selects the connection, credentials, and action
from one immutable/versioned resource snapshot and verifies the bindings in that same read
before calling the provider. Raw provider connection and action IDs remain private and never
reach the model.

## Failure behavior

| Failure | Result |
|---|---|
| Commit fails or returns `no_change` | No private event. |
| Service cannot retrieve the revision | Existing installed state remains. Log and metric only. |
| Complete resolution fails | Existing installed state remains. Log and metric only. |
| Callback target expired | Return `stale_target`. No retry against another replica. |
| Snapshot fails schema or secret validation | Reject the entire snapshot before mutation. |
| One facet group is unsupported | Leave that group unchanged and continue independent groups. |
| One facet group fails | Leave that group unchanged and continue independent groups. |
| An adapter may have partially mutated | Mark that group `dirty`; normal reconciliation must not trust its last known installed generation. |
| Snapshot arrives out of order | Return `stale_revision`. |
| Service or runner restarts | The next ordinary run resolves full state. |

No refresh failure changes the already successful commit result or creates a model-visible
error.

## Initial rollout

The first enabled live facet is the runner-owned gateway execution group. Other groups can
use the transport and state machinery but remain `unsupported` until their application
mechanisms are implemented and tested.

Subprocess runner transport remains unsupported because it has no active-run control path.
HTTP runner deployments require trusted owner routing to the correct replica before
enablement.
