# Gateway-neutral continuation interface

## Design rule

The contract describes a pending client-tool operation. It does not describe Node HTTP objects or
the runner's current pool implementation.

Each field is grouped by semantic role:

- `identity` identifies the operation and browser interaction.
- `scope` identifies the tenant boundary that may complete it.
- `routing` says where the live owner can be reached.
- `protocol` carries MCP-specific request context.
- `tool` describes the call without storing raw input.
- `lifecycle` controls expiry and terminal state.

Credentials stay under the MCP connection that they authenticate. They do not appear in operation
metadata.

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
    harnessToolCallId: string;
  };
  scope: {
    projectId: string;
    sessionId: string;
  };
  routing: {
    runnerInstanceId: string;
    environmentId: string;
  };
  protocol: {
    transport: "mcp_streamable_http";
    requestId: string | number;
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

`inputDigest` detects internal mismatches without retaining or logging raw arguments. It is not an
authorization decision and is not the live browser-result key.

## Field classification

| Field | Role | Owner | Lifetime | Reason |
| --- | --- | --- | --- | --- |
| `operationId` | Identity | Continuation registry | One operation | Stable internal idempotency key. |
| `interactionId` | Protocol context | Interaction producer | One operation | Connects to the durable interaction row and UI event. |
| `harnessToolCallId` | Protocol context | Harness correlation index | One harness call | Exact browser-result key for the live path. |
| `projectId`, `sessionId` | Scope | Platform | Session | Prevents cross-project and cross-session completion. |
| `runnerInstanceId` | Routing | Runner deployment | Process lifetime | Identifies the process that owns the live handle. |
| `environmentId` | Routing | Session engine | Live environment lifetime | Prevents a stale operation from completing a replacement session. |
| `transport` | Protocol context | Delivery adapter | One operation | Selects the adapter without exposing its implementation. The union is open: it holds only `"mcp_streamable_http"` today and grows a value per new adapter (for example `"mcp_stdio_relay"` for the in-sandbox shim, see below). |
| `requestId` | Protocol context | MCP client | One JSON-RPC request | Required in the JSON-RPC response. |
| `name`, `inputDigest` | Data description | Tool call | One operation | Supports validation and safe diagnosis without raw input. |
| `state`, timestamps | Lifecycle policy | Registry | One operation | Bounds ownership, retries, and cleanup. |

## Delivery port

The HTTP implementation can close over a Node `ServerResponse`, but only the adapter can see it:

```ts
type DeliveryResult = "written" | "transport_closed";

interface ClientToolResultDelivery {
  deliver(output: unknown): Promise<DeliveryResult>;
  cancel(reason: string): Promise<void>;
  onClosed(listener: () => void): () => void;
}
```

The in-memory registry stores the interface, not the response object. A later gateway adapter can
implement the same port with a gateway result endpoint or message queue.

Two of the port's semantics are transport-specific, and the kernel must not assume the HTTP
meanings:

- `cancel(reason)` means "release the handle and stop expecting delivery". Only the HTTP
  adapter can promise that the client saw an abort without a result (`res.destroy()`). A stdio
  or relay-backed adapter has no per-request abort: its `cancel` settles the call with a
  JSON-RPC error, or does nothing and lets the shim-side wait time out. The kernel treats a
  cancelled operation as terminal either way; what the MCP client observed is an adapter
  property.
- `onClosed` is best-effort per transport. The HTTP adapter observes the socket close. A
  relay-backed adapter running inside a sandbox has no close signal the runner can observe, so
  `onClosed` may never fire and cancellation degrades to TTL expiry and environment teardown.
  Registry cleanup must never depend on `onClosed` alone; the TTL, teardown, and shutdown
  paths in WP4 are the guaranteed exits.

## Registry contract

```ts
interface ClientToolContinuationRegistry {
  register(
    operation: PendingClientToolOperation,
    delivery: ClientToolResultDelivery,
  ): "registered" | "duplicate" | "capacity_exceeded";

  claim(input: {
    projectId: string;
    sessionId: string;
    harnessToolCallId: string;
    environmentId: string;
  }):
    | { kind: "claimed"; operation: PendingClientToolOperation; delivery: ClientToolResultDelivery }
    | { kind: "missing" | "duplicate" | "expired" | "wrong_owner" };

  markDelivered(operationId: string): void;
  cancel(operationId: string, reason: string): Promise<void>;
  cancelEnvironment(environmentId: string, reason: string): Promise<void>;
  size(): number;
}
```

`claim` is atomic. It changes `pending` to `delivering`. Only the claimant receives the delivery
port. A second caller observes `duplicate` or a terminal state and cannot write a second response.

## State machine

| From | Event | To | Required action |
| --- | --- | --- | --- |
| None | Valid single client-tool call | `pending` | Register before emitting pause. |
| `pending` | Exact browser result arrives | `delivering` | One atomic claimant receives the port. |
| `delivering` | MCP response write succeeds | `delivered` | Continue the original prompt and resolve the interaction. |
| `pending` or `delivering` | Socket closes | `cancelled` | Evict the live session and keep cold fallback available. |
| `pending` or `delivering` | Session teardown or shutdown | `cancelled` | Close the response and destroy the environment. |
| `pending` | TTL expires | `expired` | Close the response and destroy the environment. |
| Any terminal state | Late or duplicate result | Unchanged | Do not deliver again; use or retain cold fallback. |

The local implementation provides at-most-once completion of a live handle. It cannot provide
end-to-end exactly-once delivery across a process crash. The browser-side action has already
completed before the result reaches the registry, and the cold path can return that stored output
without repeating the browser action.

The "socket closes" row is transport-specific. It exists only where the adapter can observe a
close (the HTTP adapter). An adapter without a close signal (a relay-backed one) skips that row,
and its operations leave `pending` only through delivery, TTL expiry, teardown, or shutdown.

## Exact resume input

The first implementation can derive the live resume input from the existing `/run` messages:

```ts
interface ClientToolResumeInput {
  projectId: string;
  sessionId: string;
  harnessToolCallId: string;
  output: unknown;
}
```

The extractor accepts exactly one current-turn `tool_result` for the parked
`harnessToolCallId`. Missing or duplicate results do not claim the operation. The existing cold
store still indexes the same result by name and arguments if live delivery cannot proceed.

## Loopback authentication

Each internal MCP server receives a random per-environment bearer token. The ACP MCP connection
places it under the standard `authorization` header:

```ts
{
  type: "http",
  name: "agenta-tools",
  url,
  headers: [{ name: "authorization", value: `Bearer ${token}` }],
}
```

The server validates the token before `initialize`, `tools/list`, or `tools/call`. Agenta keeps the
token only for the live environment, never places it in operation metadata, and never logs it. The
harness receives it as connection credentials and may retain its own session configuration, so the
token has no value after the environment closes its dedicated server.

## Future in-sandbox stdio mapping

The in-sandbox tool MCP project
([../in-sandbox-tool-mcp/](../in-sandbox-tool-mcp/README.md), PR #5234) commits Daytona
delivery to a harness-spawned stdio shim that writes relay request files. If exact
continuation ever extends to that path, the kernel stays unchanged and a relay-backed adapter
implements the port as follows:

| Port method | Relay-backed implementation |
| --- | --- |
| `deliver(output)` | Write a late `<id>.res.json` that the shim's response wait picks up and answers on the original JSON-RPC id. |
| `cancel(reason)` | Write an error response, or write nothing and let the shim-side wait time out. No abort-without-result exists. |
| `onClosed` | Never fires. TTL and teardown are the only exits. |

Three prerequisites do not exist yet and belong to a separate bridge design, not to this
project: the relay response protocol must gain a park shape (today a paused client tool writes
no response file and the shim's wait times out at 60 seconds), the shim's per-call wait must
learn to outlive that timeout for parked calls, and the held browser wait must survive or
refuse the five-minute Daytona auto-stop that kills the shim on park-to-stopped. The
recommendation to open one owned workspace for that bridge is recorded in
[../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md).

## Future gateway mapping

A real MCP gateway can implement the same roles with different ownership:

| Local implementation | Future gateway implementation |
| --- | --- |
| In-memory registry | Durable pending-operation store with compare-and-set claim. |
| `runnerInstanceId` lookup | Gateway route to the owning runner or session worker. |
| Per-environment loopback bearer | Authenticated harness-to-gateway credential. |
| `McpHttpResultDelivery` | Gateway response stream or result-delivery endpoint. |
| Runner TTL timer | Gateway lease and retention policy. |
| Process-local metrics | Fleet-wide audit and quota metrics. |

The gateway will still need authenticated actor context, encrypted result retention, revocation,
and acknowledgement semantics. Those concerns are not hidden inside `metadata` and are not
pretended to exist in the local implementation.
