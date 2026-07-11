# Context

## What the user experiences today

Every gateway or platform tool call from a sandboxed harness pays a polling tax. The
in-sandbox writer drops a request file and sleeps in 300 ms steps until the response file
appears. The runner, on its side, discovers the request file by listing the relay directory
every 300 ms, backing off to 1.5 s when the turn is quiet. A single tool call therefore adds
roughly 0.3 s to 1.8 s of pure waiting on top of the tool's real execution time. An agent
turn that makes ten tool calls can spend over ten seconds doing nothing.

On Daytona the cost is also request volume: the runner's poll is a remote `ls` exec through
the daemon API, about three requests per second per active turn, for the whole turn.

## Settled decisions this project builds on

These are owner decisions (2026-07-11). They are inputs, not open questions.

1. **The sandbox talks only to the runner.** An API-hosted tool gateway (an MCP endpoint on
   the Agenta API that sandboxes would dial directly) was considered and rejected. Warm
   sandboxes are the priority, and the committed model is: the harness runs in the sandbox;
   tools, credentials, and policy live in the runner. The full analysis is in
   [../mcp-delivery-architecture/gateway-mcp-location.md](../mcp-delivery-architecture/gateway-mcp-location.md).
2. **Tool calls ride the file relay.** The in-sandbox writer creates `<id>.req.json` in a
   relay directory. The runner discovers it, executes the call with runner-held credentials,
   and writes `<id>.res.json`. The writer reads the response and deletes both files. No
   network path opens from the sandbox to the runner, and no credential enters the sandbox.
3. **Claude gets tools through an in-sandbox MCP shim feeding the same relay files**
   ([../claude-daytona-tools/design.md](../claude-daytona-tools/design.md)). Pi's extension
   is the first writer; the shim will be the second. Any relay change must keep the
   req/res file contract unchanged and must not assume Pi is the only writer.

## The feature

Replace the polling latency with event-driven wakeups so a tool call round-trips in
milliseconds instead of seconds. Explicitly unchanged:

- The security model. No new network surface, no credentials into the sandbox, the relay
  files stay the data channel.
- The req/res file contract (final names, contents, who deletes what). Publication
  becomes atomic (a temp name plus a same-directory rename, plan.md decision 2), which
  changes how a file appears, not what it is once it exists.
- The `/run` wire contract and the SDK.

## The reliability principle (non-negotiable)

Polling stays as the correctness fallback. The event path is an optimization layered on the
existing loop: an event only shortens the current sleep. A watcher that dies, hangs, or was
never available degrades the relay to today's polling behavior. It must never degrade to a
hang.

## Goals

- Tool-call relay overhead near zero on the local backend (both hops are local
  filesystem watches).
- Tool-call relay overhead on Daytona bounded by one daemon round-trip, not by a poll
  interval.
- Fewer daemon requests per turn on Daytona, not more.
- The same fast path works for Pi's extension today and the Claude MCP shim later.

## Non-goals

- No change to how tools are resolved, gated, or executed.
- No change to approval parking or permission gates.
- No new transport (no sockets, no tunnels, no SSE channel for tool data).
- No removal of the poll loop.
