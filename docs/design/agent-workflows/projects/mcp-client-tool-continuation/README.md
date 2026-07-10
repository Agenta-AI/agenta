# Exact client-tool continuation

Claude currently ends an Agenta client-tool turn by closing the internal MCP request without a
result. When the browser returns the result, the runner starts or loads a session and Claude asks
for the tool again. That path is safe, but it cannot preserve the original call id or arguments.

This project adds a faster exact path for local Claude sessions. The runner keeps the original MCP
request and harness prompt open, parks the session, and writes the browser result to that same
JSON-RPC request. Cold replay remains the fallback for expiry, restart, disconnect, pool pressure,
wrong-replica routing, and unsupported environments.

The first implementation does not build an MCP gateway. It defines a transport-neutral
continuation interface so a future gateway can own authentication, routing, and durable pending
operations without changing the session state machine.

## Status

Design only. Implementation has not started.

The proposed rollout is local Claude only. Pi approval parking is already implemented through the
ACP permission plane. Non-Pi Daytona runs cannot receive Agenta tools through the current internal
MCP endpoint because the endpoint binds to the runner's loopback interface.

## Documents

- [context.md](context.md) explains the current behavior, goals, scope, and user-visible result.
- [research.md](research.md) records the code findings and the effect of PRs #5153, #5185, and
  #5197.
- [interface.md](interface.md) defines the gateway-neutral pending-operation contract and state
  machine.
- [plan.md](plan.md) splits the work into progressive work packages and rollout gates.
- [qa.md](qa.md) defines unit, integration, live, security, and resource verification.
- [open-questions.md](open-questions.md) lists the decisions that still need review.
- [status.md](status.md) is the live source of truth for progress and dependencies.

## Proposed sequence

1. Measure Claude's MCP request timeout.
2. Authenticate and test the existing internal loopback MCP endpoint.
3. Add the transport-neutral continuation registry with no behavior change.
4. Add the local Claude hold-open and resume path behind a runner kill switch.
5. Close race, timeout, shutdown, and resource-limit cases before enabling it.
6. Canary locally and keep Daytona and cross-replica exact routing on the cold fallback.

