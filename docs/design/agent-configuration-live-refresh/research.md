# Research

## Current run-start resolution

The API prepares a workflow invocation and embeds or retrieves the selected revision in
`api/oss/src/core/workflows/service.py`. The service request then passes through vault,
reference resolution, and normalization middleware. The final authored parameters reach
the agent handler.

`make_agent_handler()` in `sdks/python/agenta/sdk/agents/handler.py` currently performs the
complete agent composition inline:

1. Parse `AgentTemplate` from the normalized parameters.
2. Select the backend and harness.
3. Resolve tools, including gateway connections and gateway policy.
4. Resolve MCP servers and their credentials.
5. Resolve the model connection and credentials.
6. Build `SessionConfig`.
7. Adapt the neutral configuration to the selected harness.
8. Serialize `AgentRunRequest` and call runner `/run`.

The gateway resolver already calls API `POST /tools/resolve`. The API validates the project
connection and returns catalog metadata. The SDK then calls the pure
`compile_gateway_permissions()` function with authored policy, catalog metadata, and the
agent-wide permission mode.

The service therefore already depends on the API for resource resolution. The runner
receives only the resolved result and should not duplicate the Python compiler.

## Current commit path

The model calls the reserved `commit_revision` platform tool. The runner sends it through
the existing callback to API `POST /tools/call`. The API validates access, commits the
revision, and returns a normal `ToolCallResponse`.

The callback path is implemented in:

- `services/runner/src/tools/callback.ts`
- `api/oss/src/apis/fastapi/tools/router.py`
- `api/oss/src/core/tools/platform_handlers.py`

The successful platform handler already produces `committed_revision` metadata. The router
uses it for post-commit cache invalidation and public event emission, then returns the normal
`ToolCallResponse`. The runner callback parser currently reads `call` and discards sibling
response fields. That parser is the trusted place to accept private commit metadata after the
router includes it in the response.

The router currently awaits cache invalidation and public event emission after the durable
commit and before returning the response. A failure there can make a durable commit look
failed. The notification slice must isolate all post-commit effects, not only the new private
metadata.

The public Vercel adapter separately derives a `data-committed-revision` event from a
successful tool result. The playground uses it to select the committed revision. The new
private control event must remain separate so it cannot enter the public stream or session
history.

## Current runner stream

Runner `/run` returns newline-delimited `StreamRecord` values. The current union has public
agent events and a terminal result. `AgentStream.__aiter__()` in
`sdks/python/agenta/sdk/agents/streaming.py` parses those records before the service adapts
them to Vercel, SSE, or NDJSON output.

This gives the private notification a natural path. The runner must enqueue the control
record before any terminal `kind: result` record because `AgentStream` stops at the terminal
record:

```text
runner StreamRecord(kind=control)
    -> AgentStream consumes it
    -> service control handler starts background refresh
    -> no public Event is created
```

The handler must schedule work without awaiting it in public stream iteration. A slow API
or runner must not delay the model-visible tool result.

## Exact revision retrieval

The workflows API supports retrieving one revision by exact revision ID. A variant-only
reference resolves the current head and is not suitable for asynchronous refresh.

The private commit metadata must carry at least:

- variant ID;
- revision ID;
- stored string version;
- integer ordering sequence derived from that stored decimal version.

The service verifies variant ID, revision ID, version, and sequence after retrieval. This
prevents a delayed worker for sequence N from accidentally resolving sequence N+1 after the
variant head advances.

## Complete configuration extraction

The run-start composition is inline inside `make_agent_handler()`. Reusing it requires one
extraction before refresh behavior ships. The extracted function should accept normalized
authored parameters and resolution context, then return a typed complete resolved
configuration.

`SessionConfig` is close to this object, but it does not by itself define the final
harness-specific runner projection. `request_to_wire()` also mixes stable configuration
with per-turn messages, session context, tracing, and effective parameters.

The implementation needs two explicit objects:

```text
ResolvedRunConfigSnapshot
    stable and private configuration that /run and /configuration/apply share

RunInvocationEnvelope
    messages, attachments, session and turn identity, tracing, and run context
```

The extraction must prove that an ordinary initial run produces the same wire values as
before.

## Existing desired and applied state

The runner already normalizes desired state and tracks applied environment state:

- `services/runner/src/lifecycle/desired-state.ts`
- `services/runner/src/lifecycle/reconciliation-router.ts`
- `services/runner/src/engines/sandbox_agent/applied-state.ts`
- `services/runner/src/environment/apply-plan.ts`

That state already carries semantic facet digests, one whole fingerprint, and one generation
after successful reconciliation. It cannot represent independently published facet versions,
failed or unsupported installation, or mixed-version state.

The refresh needs per-facet revision and status state beside the existing observed applied
state. The runner may install gateway policy from revision 12,
workspace files from revision 12, and leave MCP configuration at revision 11. A whole
fingerprint must not claim that revision 12 is completely active.

## Installation and observation

The existing harness reconciliation contract advances observed applied state only after a
harness acknowledgement. This project introduces a separate concept: installation.

The runner may replace an instructions file even when the active harness does not reread
it. That file is installed from the new revision. Whether the harness observes it is an
adapter concern and may remain unknown.

Runner-owned values need no harness acknowledgement. The runner is their consumer, so a
gateway execution policy is both installed and observed when the runner atomically swaps its
private execution cell.

This distinction permits asynchronous best effort without making false claims about what a
model has already consumed.

## Active-run targeting

The service must send the snapshot to the runner process that owns the active run. The normal
internal runner URL may be load balanced across replicas. Existing session affinity records
identify a replica but do not route a new HTTP request to it.

The runner control record therefore carries an opaque active-run target. The service gives
that target to its configured runner transport. It never follows a runner-supplied URL. The
HTTP transport needs an operator-configured control router or an equivalent trusted mapping
from owner ID to replica. Production rollout is blocked until that routing mechanism exists.

Subprocess runner transport closes stdin after the initial request and has no callback HTTP
surface. The first implementation should report refresh transport as unsupported there and
leave current state unchanged.

## Active-run registry

The existing session pool does not cover every HTTP run, including non-session and
keepalive-disabled runs. The runner needs a process-local active-run registry keyed by a
runner-issued `activeRunId`. Session and turn identity are optional scope checks. An entry owns:

- the callback credential lifetime;
- the active run's bound variant and its highest announced revision;
- serialized snapshot application;
- installed and observed facet state;
- mutable runner-owned execution cells;
- cleanup when the turn or environment ends.

Applying a snapshot to an absent or ended target returns a benign stale-target result.

## Ordering

Two commits can resolve and arrive out of order. When the runner observes a commit event,
it records the highest announced sequence before it emits the private control record. A
snapshot older than that watermark cannot install later, even if the newer snapshot fails.

Duplicate event IDs and revision IDs are idempotent. Snapshot application is serialized per
active run. Independent facet groups may succeed independently inside one application.

## Secrets and fingerprints

The complete stable snapshot can carry model credentials, MCP credentials, code-tool
environment values, and static tool headers. These values must use the same protected
service-to-runner hop as `/run`. Tool callback authorization, current telemetry authorization,
and exporter context remain invocation-owned and stay in the separate invocation envelope.

Before either service or runner logs, traces, persists, or applies a refreshed snapshot, it
must extend the active redactor with newly resolved secret values. Secret values must not
enter configuration fingerprints, event metadata, apply responses, or logs.

Current code needs specific audit work here. Code-tool environment values and arbitrary
static headers can enter broad configuration hashes without complete redactor coverage.
The snapshot extraction slice must close those gaps before live credential-bearing facets
are enabled.

## Gateway policy as the first facet

The gateway branch already normalizes one `gatewayPolicy` at relay creation. Live
installation replaces that fixed value with an atomic cell.

Each gateway call captures one immutable policy generation at call start and uses it for:

- authorization;
- connection routing;
- search filtering;
- suggestion sanitization;
- approval generation.

A gateway call captures one generation, but rechecks the current generation before dispatching
its authenticated API callback. A callback already sent finishes under its capture; a call
that has not crossed that boundary fails closed after tightening. Gateway search memory clears
after a successful swap because prior results were filtered under the old policy.

The first gateway connection also changes the model-visible tool catalog. Installing its
private policy alone does not make the tools visible. The separate tools dependency group
reports unsupported until the selected harness can accept the derived tools and matching
execution plan. Removing the last connection can still revoke private execution immediately
even if stale generic tool names remain visible.
