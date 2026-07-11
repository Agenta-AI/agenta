# Plan

## Decision summary

Build an exact local continuation path as a cache above the existing cold fallback.

- Use the original ACP tool-call id for live browser-result correlation.
- Add a dedicated `awaiting_client_tool` pool state and resume verb.
- Keep raw HTTP state inside an MCP delivery adapter.
- Authenticate the current loopback endpoint before holding requests open.
- Support one pending client tool per local Claude session and reject client-tool batches.
- Add a runner-only kill switch. Do not add a frontend flag.
- Start the lifecycle-changing work only after PR #5197 merges and the branch rebases.
- Leave Daytona exact delivery, cross-replica routing, and a real MCP gateway out of scope.

## Dependency order

```text
WP0 timeout measurement
  -> WP1 loopback hardening
    -> WP2 neutral continuation kernel
      -> WP3 local hold-open path
        -> WP4 failure and resource envelope
          -> WP5 canary and rollout
```

WP0 through WP2 can be prepared independently. WP3 edits the same environment, park, teardown,
and continuity code as PR #5197, so it starts after that PR lands.

## WP0: measure the transport ceiling

### Purpose

The runner controls the server side of the internal MCP request. Claude controls the client-side
timeout. No design can promise a five-minute park until the real client is measured.

### Work

- Add a repeatable local Claude experiment that exposes one client tool and intentionally delays
  its result.
- Record the pinned Claude harness, ACP adapter, MCP SDK, Node, and runner versions.
- Test a hold longer than the 60-second idle TTL first.
- If that succeeds, test beyond the 300-second approval TTL.
- Record whether Claude keeps the same MCP request id and ACP tool-call id, closes the connection,
  retries, or settles the call with an error.
- Measure one quiet pending socket's file-descriptor and memory delta separately from the already
  measured live Claude process tree.

### Exit gate

The first release proceeds only if the request remains usable beyond the 60-second idle TTL. If it
does not, keep the current cold path and stop the hold-open implementation. If it covers 60 seconds
but not five minutes, cap the live wait below the measured limit with a safety margin and fall back
cold for longer waits.

### Deliverable

A checked-in experiment protocol and report. No production behavior change.

## WP1: harden the existing internal MCP endpoint

### Purpose

The endpoint already dispatches Agenta tools and currently relies only on loopback reachability.
Hold-open increases its lifetime, so authentication and direct transport tests come first.

### Work

- Generate a random bearer token per session environment.
- Advertise the token in the MCP server's standard `authorization` header.
- Reject missing or wrong tokens before parsing or dispatching a tool call.
- Place the token validation in the HTTP transport wrapper in `tool-mcp-http.ts`, never in
  the transport-neutral message handler that PR #5234 extracts as `tools/mcp-handler.ts`.
  The in-sandbox stdio shim shares that handler and must stay credential-free; only the
  listener-owning HTTP transport has anything to authenticate.
- Keep the existing one-megabyte request-body cap and add an explicit result-size cap.
- Reject a JSON-RPC batch containing a client tool before executing any item in that batch.
- Keep non-client batches unchanged unless a test finds a protocol violation.
- Add focused HTTP integration tests for initialize, list, normal call, unauthorized call,
  malformed JSON, oversized body, client-tool batch rejection, and close.
- Run one live local Claude test to confirm the ACP adapter forwards MCP headers.

### Exit gate

An unauthenticated sibling process cannot list or call tools. Valid local Claude behavior remains
unchanged. The MCP server integration suite owns its real socket lifecycle.

### Rollback

Revert this package independently. It does not depend on hold-open behavior.

## WP2: add the neutral continuation kernel

### Purpose

Introduce the identity, lifecycle, and ownership rules before any HTTP request is held.

### Work

- Add the operation, registry, and delivery-port interfaces from [interface.md](interface.md).
- Implement an in-memory registry with atomic claim and terminal transitions.
- Enforce one pending client tool per environment and a global cap no greater than the session
  pool cap.
- Add `environmentId` and `runnerInstanceId` routing identity without exposing them on the public
  `/run` wire.
- Add expiry and environment-wide cancellation.
- Add counters and durations with ids, inputs, outputs, and credentials excluded.
- Add unit tests for registration, duplicate registration, capacity, claim races, late completion,
  expiry, transport close, and environment cancellation.
- Add the runner-only `AGENTA_RUNNER_CLIENT_TOOL_CONTINUATION` kill switch, default off.

### Exit gate

The registry has full deterministic unit coverage. No request is held and current client-tool
behavior is byte-for-byte unchanged while the kill switch is off.

## WP3: wire the local Claude hold-open path

### Purpose

Use the neutral kernel to resume the original MCP call and harness prompt.

### Work

#### Register and park

- In the single-message `tools/call` path, create an `McpHttpResultDelivery` before pausing.
- Extend the client-tool relay result so the transport receives the correlated ACP tool-call id
  and interaction id.
- Register the operation before emitting the pause. If registration fails, use today's
  `MCP_PAUSED` destroy-and-cold behavior.
- Record `parkedClientTool` on the environment with the neutral operation and original prompt
  promise.
- Teach the pause callback to preserve the MCP server and session only when a valid
  `parkedClientTool` exists and the kill switch is on.
- Add `awaiting_client_tool` to the pool with the approval TTL capped by WP0's measured transport
  ceiling.

#### Claim and resume

- Add an exact current-turn extractor for one `tool_result` with the parked ACP tool-call id.
- In `server.ts`, validate project, session, history fingerprint, mount expiry, operation owner,
  and exact tool-call id. Do not compare newly minted per-turn credentials with the parked
  environment, matching the existing approval-resume rule.
- Atomically check out the `awaiting_client_tool` session. A losing request cannot access the
  delivery port.
- Add a `resumeClientTool` form to `runTurn`. It installs the new turn's stream and trace sink,
  seeds the existing tool-call span, writes the real JSON-RPC result, and awaits the original
  prompt promise.
- Resolve the interaction only after delivery succeeds and the continuation is accepted.
- Re-park a normally completed continuation as idle. A new gate can use its own state.

#### Preserve fallback

- Do not consume or remove the browser output from the inbound request before delivery succeeds.
- On a missing handle, wrong owner, closed transport, delivery failure, or lost checkout race,
  destroy the stale live environment and run the existing cold path with the original request.
- Do not retry cold after continuation output has already streamed to the caller, matching the
  current no-duplicate-stream rule.

### Exit gate

A real HTTP integration test proves that the original JSON-RPC request stays open, receives the
browser output once, and returns the same request id. A runner integration test proves that the
original prompt continues without a second model-issued client-tool call.

### Rollback

Disable `AGENTA_RUNNER_CLIENT_TOOL_CONTINUATION`. The code returns to the existing socket destroy
and cold replay path without a deployment rollback.

## WP4: complete the failure and resource envelope

### Purpose

Default-off happy-path code is not ready to enable until every long-lived-resource exit is tested.

### Work

- Cancel and evict when the MCP client closes the held request.
- Cancel and evict on approval TTL, mount expiry, pool eviction, supersede, environment destroy,
  runner shutdown, and failed original prompt.
- Reject duplicate browser results, duplicate `/run` requests, a result for another tool-call id,
  and a second pending client tool in the same session.
- Keep one terminal result for each operation and make every cleanup method idempotent.
- Add global pending-operation and held-socket gauges. Alert before the configured pool cap.
- Confirm that pending sockets cannot exceed parked sessions and that both return to baseline after
  expiry and shutdown.
- Add structured path metrics: `live`, `cold`, `unsupported`, `expired`, `wrong_replica`,
  `transport_closed`, and `delivery_failed`.
- Add a bounded load test at the configured pool maximum and one over-cap request.
- Add process shutdown and restart tests that prove browser output remains usable by the cold path.

### Exit gate

- No cross-session or cross-project completion in tests.
- No duplicate completion in race tests.
- No held responses or registry entries after expiry, disconnect, shutdown, or destroy.
- The over-cap case falls back cold without exceeding the configured cap.
- Logs and metrics contain no arguments, outputs, bearer tokens, or credentials.

## WP5: canary and rollout

### Stage 1: development

- Enable the kill switch on a single local runner replica.
- Run the live matrix in [qa.md](qa.md), including waits above 60 seconds and cold fallback after
  forced expiry.
- Compare model-call traces between the exact and cold paths. The exact path must not contain a
  second client-tool decision.

### Stage 2: limited environment

- Enable only where local Claude sessions and session keepalive are already enabled.
- Keep Daytona and other unsupported harnesses on today's behavior: cold replay where a
  delivery path exists, and the up-front refusal for Daytona client tools (which PR #5234
  narrows but keeps for client tools).
- Watch pending count, completion path, wait duration, socket close, expiry, wrong-replica, pool
  eviction, and process file descriptors.

### Stage 3: default decision

Decide whether to turn the runner flag on by default only after the canary establishes the real
timeout and fallback rates. Keep the kill switch after default-on so an MCP client upgrade can be
disabled without a frontend or API deployment.

## Deployment and compatibility notes

- PR #5197 must merge before WP3 starts. Rebase and re-check `sandbox_agent.ts`, `server.ts`,
  `session-pool.ts`, continuity invalidation, and `shouldPark` before editing.
- PR #5234 ([../in-sandbox-tool-mcp/](../in-sandbox-tool-mcp/README.md)) refactors the same
  files WP1 and WP3 edit: its slice 1 extracts the transport-neutral message handler from
  `tool-mcp-http.ts` into `tools/mcp-handler.ts` (with an optional client-tool pause hook)
  and the relay writer from `dispatch.ts` into `tools/relay-client.ts`. Land that slice
  first. WP1's batch rejection then goes into the shared handler, WP1's bearer stays in the
  HTTP transport wrapper (see WP1), and WP3's register-before-pause logic plugs into the
  handler's pause hook. The combined landing order across the three tool projects is in
  [../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md).
- PR #5197's Daytona auto-stop default is five minutes, the same as the approval TTL. This project
  does not rely on that equality because the exact path is local only.
- A wrong replica cannot access the live handle. It uses cold fallback. A future gateway can route
  the completion to the owner through the neutral registry contract.
- A future actor or principal id belongs in authenticated request context when the platform makes
  it available. Do not infer one from a tool name, browser payload, or untrusted metadata.
- No new public wire field is required for the first release because the existing browser
  `tool_result.toolCallId` is the exact live key.

