# Gateway-neutral continuation interface

Status: design note for the deferred warm path (see [plan.md](plan.md)). Nothing here is
scheduled for implementation until the unlock gates pass. Revised 2026-07-11 after the
Codex review: the delivery port shrank to delivery plus disposal, transport liveness became
an optional adapter-owned signal, the standalone registry was replaced by pool-owned
placement, and `harnessToolCallId` was renamed.

## Design rule

The contract describes a pending client-tool operation. It does not describe Node HTTP
objects or the runner's current pool implementation.

Each field is grouped by semantic role:

- `identity` identifies the operation and browser interaction.
- `scope` identifies the tenant boundary that may complete it.
- `routing` says where the live owner can be reached.
- `tool` describes the call without storing raw input.
- `lifecycle` controls expiry and terminal state.

Credentials stay under the MCP connection that they authenticate. They do not appear in
operation metadata. Adapter-specific protocol context (the JSON-RPC `requestId`, the
transport kind) lives with the adapter that needs it, not in the neutral operation.

## Operation shape

The following TypeScript is a design contract, not a required final spelling:

```ts
type PendingClientToolState =
  | "pending"
  | "delivering"
  | "delivered"
  | "cancelled"
  | "expired";

interface PendingClientToolOperation {
  identity: {
    operationId: string;
    interactionId: string;
    toolCallId: string;
  };
  scope: {
    projectId: string;
    sessionId: string;
  };
  routing: {
    runnerInstanceId: string;
    environmentId: string;
  };
  tool: {
    name: string;
    inputDigest: string;
  };
  lifecycle: {
    state: PendingClientToolState;
    createdAt: number;
    expiresAt: number;
  };
}
```

**Provenance of `toolCallId`, stated as an invariant:** it is the harness-correlated ACP
tool-call id, the exact key a browser result carries back. Current correlation is
best-effort and falls back to the MCP-generated random id when matching fails; that
fallback id must never enter this field. Warm registration is allowed only when the
correlation index returned a real harness tool-call id; otherwise the runner destroys the
MCP response and uses cold replay. The registration gate is what proves the provenance; the
earlier name `harnessToolCallId` asserted more than the code guaranteed.

`inputDigest` detects internal mismatches without retaining or logging raw arguments. It is
not an authorization decision and is not the live browser-result key.

## Delivery port

The port carries exactly two capabilities: deliver a result, release adapter-owned
resources. The HTTP implementation can close over a Node `ServerResponse`, but only the
adapter can see it:

```ts
interface ClientToolResultDelivery {
  deliver(output: unknown): Promise<
    | { kind: "accepted" }
    | { kind: "unavailable"; reason: string }
  >;

  dispose(reason: string): Promise<void>;
}
```

- `deliver` attempts to hand the browser output to the waiting client. `accepted` means the
  transport took the response; `unavailable` means it cannot (closed socket, dead handle)
  and the caller falls back cold with the preserved result.
- `dispose` means only "release adapter-owned resources". It makes no claim about what the
  remote MCP client observed. For a future relay-backed adapter, whether abandoning a call
  writes a JSON-RPC error or writes nothing is a protocol decision that adapter documents;
  it is not hidden inside a generic `cancel`.

The earlier port also required `cancel(reason)` and `onClosed(listener)`. Both modeled an
HTTP response handle and were cut: a relay-backed adapter has no per-request abort and no
close signal, and a port is not neutral because its awkward methods "may do nothing".

**Transport liveness is optional adapter input, not part of the port.** The HTTP adapter
may own a closed signal (the socket close event) and use it to trigger early cleanup.
Correctness must never depend on it: lease expiry and environment teardown are the
guaranteed exits for every adapter.

## Placement instead of a registry

A standalone `ClientToolContinuationRegistry` is premature. The session pool already owns
capacity, TTL, atomic checkout, and environment teardown, and the first release would allow
exactly one pending client tool per environment. If the warm path is built:

- `ParkedClientTool` sits beside `ParkedApproval` in the sandbox-agent session model,
  holding the neutral operation, the delivery port, and the original prompt promise.
- `awaiting_client_tool` and its dedicated checkout live in `session-pool.ts`. Checkout is
  the atomic claim: a losing request never sees the delivery port.
- The claim behaves as a lease: a checkout that fails to deliver must finalize (deliver,
  dispose, or re-park) within a bounded time, finalization is idempotent, and expiry
  applies to a claimed operation the same as to a pending one.
- The exact current-turn result extraction sits beside the existing responder extractors.
- `McpHttpResultDelivery` sits under `tools/` as transport code.

A durable pending-operation registry appears only at a future gateway boundary, where a
second implementation exists to constrain the abstraction.

## State machine

| From | Event | To | Required action |
| --- | --- | --- | --- |
| None | Valid single client-tool call with proven correlation | `pending` | Register before emitting the pause; on failure, commit the cold-pause form. |
| `pending` | Exact browser result arrives | `delivering` | One atomic claimant receives the port. |
| `delivering` | `deliver` returns `accepted` | `delivered` | Continue the original prompt and resolve the interaction. |
| `delivering` | `deliver` returns `unavailable`, or the claimant fails to finalize within the lease | `cancelled` | Dispose, evict the live session, fall back cold with the preserved result. |
| `pending` or `delivering` | Session teardown or shutdown | `cancelled` | Dispose and destroy the environment. |
| `pending` | TTL expires | `expired` | Dispose and destroy the environment. |
| `pending` | Adapter-owned closed signal fires (optional) | `cancelled` | Early cleanup only; expiry and teardown remain the guaranteed exits. |
| Any terminal state | Late or duplicate result | Unchanged | Do not deliver again; use or retain cold fallback. |

Terminal entries are retained for the length of the session turn so a late duplicate reads
as `duplicate` rather than `missing`; after that, cleanup may drop them.

The local implementation provides at-most-once completion of a live handle. It cannot
provide end-to-end exactly-once delivery across a process crash. The browser-side action
has already completed before the result reaches the runner, and the cold path can return
that stored output without repeating the browser action.

## Exact resume input

The first implementation can derive the live resume input from the existing `/run`
messages:

```ts
interface ClientToolResumeInput {
  projectId: string;
  sessionId: string;
  toolCallId: string;
  output: unknown;
}
```

The extractor accepts exactly one current-turn `tool_result` for the parked `toolCallId`.
Missing or duplicate results do not claim the operation. The existing cold store still
indexes the same result by name and arguments if live delivery cannot proceed.

## Loopback authentication

This section backs WP1, which ships now regardless of the warm path.

Each internal MCP server receives a random per-environment bearer token. The ACP MCP
connection places it under the standard `authorization` header:

```ts
{
  type: "http",
  name: "agenta-tools",
  url,
  headers: [{ name: "authorization", value: `Bearer ${token}` }],
}
```

The server validates the token, from the request headers and with a timing-safe
comparison, before `initialize`, `tools/list`, or `tools/call`. Agenta keeps the token only
for the live environment, never places it in operation metadata, and never logs it. The
harness receives it as connection credentials and may retain its own session
configuration, so the token has no value after the environment closes its dedicated
server.

## Future in-sandbox stdio mapping

The in-sandbox tool MCP project
([../in-sandbox-tool-mcp/](../in-sandbox-tool-mcp/README.md), PR #5234) commits Daytona
delivery to a harness-spawned stdio shim that writes relay request files. If exact
continuation ever extends to that path, a relay-backed adapter implements the port as
follows:

| Port method | Relay-backed implementation |
| --- | --- |
| `deliver(output)` | Write a late `<id>.res.json` that the shim's response wait picks up and answers on the original JSON-RPC id. `unavailable` when the relay dir or shim is gone. |
| `dispose(reason)` | Adapter decision, documented there: write an error response, or write nothing and let the shim-side wait time out. |
| Closed signal | None. TTL and teardown are the only exits, which the slimmed port already assumes. |

Three prerequisites do not exist yet and belong to a separate bridge design, not to this
project: the relay response protocol must gain a park shape (today a paused client tool
writes no response file and the shim's wait times out at 60 seconds), the shim's per-call
wait must learn to outlive that timeout for parked calls, and the held browser wait must
survive or refuse the five-minute Daytona auto-stop that kills the shim on
park-to-stopped. The recommendation to open one owned workspace for that bridge is recorded
in
[../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md).

## Future gateway mapping

A real MCP gateway can implement the same roles with different ownership:

| Local implementation | Future gateway implementation |
| --- | --- |
| Pool-owned `ParkedClientTool` | Durable pending-operation store with compare-and-set claim. |
| `runnerInstanceId` lookup | Gateway route to the owning runner or session worker. |
| Per-environment loopback bearer | Authenticated harness-to-gateway credential. |
| `McpHttpResultDelivery` | Gateway response stream or result-delivery endpoint. |
| Pool TTL timer | Gateway lease and retention policy. |
| Process-local metrics | Fleet-wide audit and quota metrics. |

The gateway will still need authenticated actor context, encrypted result retention,
revocation, and acknowledgement semantics. Those concerns are not hidden inside `metadata`
and are not pretended to exist in the local implementation.
