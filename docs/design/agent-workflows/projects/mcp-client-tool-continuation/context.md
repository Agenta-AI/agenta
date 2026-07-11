# Context

## The two tool paths called MCP

User-configured MCP servers and Agenta client tools are different paths.

- A user MCP server is supplied by the user. Claude calls that server directly.
- An Agenta tool is resolved by the platform. For local Claude, the runner exposes those tools
  through a small internal MCP HTTP server in `tool-mcp-http.ts`.
- A client tool is an Agenta tool whose result comes from the browser. `request_connection` is one
  example. The runner must pause while the user completes the browser interaction.

This project changes only the third path. It does not change user MCP servers, tool resolution, Pi
tool delivery, or the public `/run` request shape.

## Current client-tool flow

The current local Claude flow is:

1. Claude sends `tools/call` to the runner's loopback MCP server.
2. The runner validates the arguments, correlates the call with Claude's ACP tool-call id, emits a
   `client_tool` interaction, and pauses the turn.
3. `tool-mcp-http.ts` returns the internal `MCP_PAUSED` sentinel. The HTTP listener calls
   `res.destroy()` without writing a JSON-RPC result.
4. The runner tears down the prompt or session unless another parkable gate owns it.
5. The browser adds a `tool_result` to a new `/run` request.
6. The cold path indexes that result by tool name and canonical arguments. Claude reissues the
   client tool, and the runner returns the stored browser output.

The cold path is fail-safe. If the model changes the arguments, the stored result does not match
and the user sees the interaction again. The cost is that the original MCP request is gone, the
new call has a new id, and the model has made another decision.

## Desired warm flow

This flow is the deferred goal, not the first deliverable; [plan.md](plan.md) gates it on
two measurements. The exact path changes steps 3 through 6:

1. The runner leaves the original JSON-RPC response open.
2. The session pool parks the live harness in `awaiting_client_tool` with the original prompt
   promise and a transport-neutral pending-operation handle.
3. The browser result arrives in a new `/run` request and matches the original ACP tool-call id.
4. The runner atomically claims the pending operation and writes the result to the held JSON-RPC
   response.
5. Claude settles the original tool call and continues the original prompt. The new `/run` owns
   streaming and tracing for the continuation.

There is no new model request between the browser result and continuation of the original prompt.

## How PR 5197 changes the fallback

PR #5197 adds native harness session continuity, durable harness-session ids, reconnectable Daytona
sandboxes, and `session/load`. Those changes improve the path after a live park is lost. They do
not answer an MCP request that was already destroyed.

After PR #5197:

- A live pending operation is still the only exact path.
- If the live operation is gone, `session/load` restores structured harness history when eligible.
- Claude settles the interrupted pending call and reissues it with a new id. The stored browser
  output answers that new call through the existing cold decision store.
- Plain cold replay remains the final fallback when native session load is unavailable or stale.

The pending socket must not be stored in `session_states.data`. A Node `ServerResponse` belongs to
one process and cannot survive a process restart. PR #5197's durable state is context recovery, not
a pending-operation ledger.

## Goals

- Continue the original local Claude MCP call after a browser result arrives.
- Preserve the original harness tool-call id, tool name, arguments, and prompt.
- Keep cold replay as a correct fallback for every failure and unsupported case.
- Authenticate the internal MCP endpoint before increasing its lifetime.
- Bound pending sessions, sockets, output size, and wait time.
- Make duplicate, late, expired, and disconnected results deterministic.
- Expose metrics that distinguish exact continuation from cold fallback.
- Define an interface that an in-memory runner implementation and a future MCP gateway can both
  implement.

## Non-goals

- Building or selecting a production MCP gateway.
- Making the runner-loopback MCP endpoint reachable from Daytona.
- Adding cross-replica forwarding or changing load-balancer routing.
- Guaranteeing end-to-end exactly-once delivery across a runner crash.
- Changing the public `/run` wire shape in the first implementation.
- Replacing the existing cold name-and-arguments matching path.
- Supporting MCP batches that contain a client tool.
- Supporting more than one pending client tool per session in the first release.
- Changing Pi. Pi approval gates already use the ACP permission plane.

## Invariants

1. A browser result can complete only a pending operation in the same project and session and with
   the same harness tool-call id.
2. One pending operation has at most one successful claimant and one terminal outcome.
3. No tool arguments, browser outputs, bearer tokens, or credentials appear in logs or metrics.
4. A transport failure never discards the inbound browser result before cold fallback can read it.
5. Expiry, shutdown, client disconnect, pool eviction, and duplicate completion close the held
   response and reclaim the session.
6. Unsupported cases use today's cold path. They do not fail the run only because exact
   continuation is unavailable.
7. The default remains off until timeout, security, race, and resource tests pass.

## Scope of the first warm release, if it unlocks

A warm release requires all of the following:

- Claude or another non-Pi harness using the internal MCP channel.
- A local sandbox, because the internal MCP endpoint is runner-loopback only.
- Session keepalive enabled.
- The client-tool continuation kill switch enabled.
- A single JSON-RPC call, not a batch.
- No other pending client tool in the same session.
- The resume request reaches the runner replica that owns the live operation.

If any condition is false, the runner closes the original request as it does today and uses cold
replay. A multi-replica deployment can therefore remain correct without new routing, although its
exact-continuation hit rate may be lower.

