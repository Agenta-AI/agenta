# Research

## Repository snapshot

Research was completed on 2026-07-10 with the GitButler workspace based on `big-agents` commit
`cb63991eaa7d757c98d7c02a54382403fbe348ff` and `behind: 0`.

- PR #5185, Pi approval parking, is merged. Pi now parks both approval gate types on the ACP
  permission plane.
- PR #5153, the broader session keepalive design, remains a draft design PR. Its client-tool
  follow-up recommends holding the MCP socket open, subject to measuring Claude's client timeout.
- PR #5197 was reviewed at head `343d7146935a8eb3ed41a203cd9a3db6ee954eef`. It is open against
  `big-agents` and adds harness continuity and sandbox lifecycle support.

The session keepalive design files are currently supplied by PR #5153 rather than `big-agents`.
This workspace repeats the required context so this design PR remains self-contained.

## Current runner findings

### The internal MCP server aborts a client-tool response

`services/runner/src/tools/tool-mcp-http.ts` starts a stateless Streamable HTTP server on
`127.0.0.1`. Its client-tool branch:

- validates required arguments;
- creates a runner-local call id;
- calls the shared `ClientToolRelay`;
- returns `MCP_PAUSED` when browser input is needed; and
- destroys the response socket when the listener sees that sentinel.

The server also supports JSON-RPC batches. One paused client tool currently aborts the whole batch,
including responses for unrelated calls in the same HTTP request.

There is no focused integration test that starts this server, sends a real HTTP MCP request, holds
it, and observes teardown. Most coverage reaches the behavior through engine fakes.

### The internal endpoint has no application authentication

`services/runner/src/tools/mcp-bridge.ts` advertises the endpoint with an empty `headers` list. The
server relies on loopback reachability. The same endpoint can dispatch non-client Agenta tools via
`runResolvedTool`.

Loopback limits network reachability, but it is not an authorization boundary between processes in
the same host or network namespace. Extending the server and socket lifetime increases the window
in which a sibling process could call it. A per-environment bearer token is therefore a prerequisite
for hold-open behavior, even though the missing authentication predates this project.

The bearer is defense in depth, not host isolation. A process that can inspect another process's
memory or IPC may still recover it. Strong workload identity and process isolation belong to the
deployment boundary or a future gateway.

### Exact ACP correlation already exists

`services/runner/src/engines/sandbox_agent/client-tools.ts` uses a
`ToolCallCorrelationIndex` for Claude. It maps the internal MCP call to the real ACP tool-call id
before emitting the browser interaction. Pi already has an exact relay id.

The pending-operation design should reuse that correlated ACP id. It should not use the internal
random relay id or the cold `approvedCallKey(name, args)` as the live identity.

### Cold result storage is separate and consume-once

`services/runner/src/responder.ts` builds a FIFO client-tool output store from inbound
`tool_result` blocks. The store is keyed by tool name plus canonical arguments because a cold model
reissue has a new id.

That store remains the fallback. The live path needs a new exact extractor keyed by the original
ACP tool-call id. It must read, not consume, the inbound result until the held MCP response has been
written or the request has fallen back to cold.

### The keepalive pool needs a distinct state

`services/runner/src/engines/sandbox_agent/session-pool.ts` currently has `busy`, `idle`,
`awaiting_approval`, and `destroyed`. `server.ts` checks out `awaiting_approval` only when it finds
an approval envelope for the parked ACP tool-call id.

A client-tool result is not an approval decision and does not call `respondPermission`. Reusing
`awaiting_approval` would mix different resume verbs and validation rules. The pool needs
`awaiting_client_tool`, with a dedicated checkout method and expiry label.

### The harness prompt can remain pending

`runTurn` already retains the original prompt promise for a parked ACP approval. A pause controller
returns the turn to the HTTP caller while the prompt stays unresolved. The next `/run` installs a
new streaming and tracing sink, answers the held gate, then awaits the original prompt.

Client-tool continuation can reuse that pattern. The difference is the resume verb: write the
browser output to the held MCP response instead of calling `respondPermission`.

The pause callback currently aborts the environment's MCP controller for a non-approval pause. A
parkable client-tool record must exist before the pause fires so the callback can preserve the MCP
server and session only for that case.

### The internal MCP channel is local only

`services/runner/src/engines/sandbox_agent/mcp.ts` skips the internal MCP channel on Daytona.
`127.0.0.1` inside the sandbox is not the runner's loopback interface. Non-Pi Daytona runs with
Agenta tools are rejected before session creation because no delivery path exists. PR #5234
([../in-sandbox-tool-mcp/](../in-sandbox-tool-mcp/README.md)) narrows that refusal: after its
slice 2, gateway tools reach MCP-client harnesses on Daytona through an in-sandbox stdio shim
and the file relay, and the up-front refusal remains only for client tools and for non-Daytona
remote providers.

PR #5197 reconnects and resumes Daytona sandboxes, but it does not change this transport boundary.
Exact client-tool continuation on Daytona therefore requires either a future MCP gateway or a
relay-backed delivery adapter built on PR #5234's shim (the unowned bridge described in
[interface.md](interface.md)). Both are outside this project.

## Effect of PR 5197

PR #5197 provides useful lower-level lifecycle behavior:

- per-harness session ids and a staleness guard;
- native `session/load` when the harness supports it;
- durable transcript mounts without persisting login credentials;
- reconnectable Daytona sandbox ids and hot, warm, cold, dead, and new lifecycle rungs;
- local replica ownership checks;
- continuity invalidation after paused, failed, or aborted turns;
- Compose passthrough for the Daytona lifecycle timers;
- a production-code pin that loaded sessions receive only the new user message;
- process-group cleanup; and
- a shared `shouldPark` policy that avoids parking failed or paused ordinary turns.

This project should integrate with those rules after PR #5197 merges. In particular, a held
client-tool pause is a deliberate exception to the ordinary "paused turns do not park" rule. The
exception must be explicit and identity-bound.

PR #5197 does not provide:

- a held MCP response;
- a pending client-tool registry;
- exact browser-result correlation for a live MCP request;
- authentication for the internal loopback endpoint;
- routing to the replica that owns a pending operation; or
- durable result delivery and acknowledgement.

Its `session_states.data` synchronization is a best-effort read, merge, and write path. This design
must not treat it as an atomic operation ledger. The live handle stays process-local. A future
gateway can supply durable operation storage behind the neutral interface.

## Old risks and risks introduced by hold-open

| Risk | Origin | Treatment in this plan |
| --- | --- | --- |
| Unauthenticated loopback MCP endpoint | Existing | Fix before hold-open in WP1. |
| Direct tool dispatch from the internal endpoint | Existing | Require the per-environment bearer before list or call. |
| Cold name-and-arguments matching | Existing | Retain only as fallback; use exact tool-call id when live. |
| Batch pause aborts all batch responses | Existing | Reject client-tool batches before any batch item executes. |
| No direct MCP HTTP lifecycle test | Existing | Add in WP1 and extend in WP3 and WP4. |
| Per-session memory cost and pool pressure | Existing keepalive | Reuse the pool cap and never exceed one pending client tool per session. |
| Multi-replica warm state is process-local | Existing keepalive | Wrong replica falls back cold; no forwarding in scope. |
| Claude MCP client timeout is unknown | Existing latent limit | Measure in WP0 before choosing a live TTL. |
| Duplicate or racing browser results | New | Atomic claim and terminal state machine in WP2 and WP4. |
| Long-lived sockets and file descriptors | New | Global cap, TTL, disconnect cleanup, shutdown drain, and load test. |
| Output lost between claim and delivery | New | Keep inbound request readable until delivery succeeds; otherwise evict and replay cold. |
| Raw Node response leaks into generic session state | New design risk | Hide it inside the MCP delivery adapter. |

## Design consequences

1. Authentication and real HTTP integration tests come before new hold behavior.
2. The live identity is project, session, and original ACP tool-call id.
3. The internal JSON-RPC request id stays as protocol context. It is required to write the correct
   response but is not the browser correlation key.
4. The session pool stores a neutral operation descriptor and delivery port, not a
   `ServerResponse`.
5. The first release rejects client-tool batches and multiple pending calls.
6. The exact path is an optimization with a strict cold fallback, not a new source of durable
   truth.
7. Daytona and cross-replica exact continuation remain future gateway responsibilities.
