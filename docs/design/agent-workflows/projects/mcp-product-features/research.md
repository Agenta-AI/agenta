# Research

## Existing seams

- Claude receives external HTTP MCP entries through ACP session initialization.
- Pi uses the Agenta tool plane and does not currently consume ACP MCP entries.
- The runner already validates external URLs and blocks unsafe SSRF targets.
- The service already resolves project secret references per run.
- Claude ACP exposes MCP status and reconnect surfaces, but Agenta discards that state.
- The UI already consumes the runtime harness catalog and can gate feature surfaces per harness.

## Architectural choice still open

There are two credible execution shapes:

1. Direct per-harness clients. Claude keeps ACP delivery and Pi gains a runner MCP client that
   projects tools onto its existing tool plane.
2. A platform MCP gateway owns upstream sessions, credentials, discovery, policy, and calls, then
   projects tools onto the common Agenta plane for both harnesses.

The gateway is attractive for credential isolation and parity, but it adds session ownership,
scaling, routing, and observability work. The plan must compare those costs against the concrete
Pi 2.2 bridge instead of assuming the answer.

## Security facts

- Saved configs may contain secret names, never values.
- Direct Claude delivery puts resolved header values in service, runner, ACP, and harness process
  memory.
- Daytona secret facilities can narrow one remote path but do not solve local and Daytona with one
  boundary.
- A platform gateway can keep upstream values outside harness sandboxes, but only if it owns calls
  rather than returning credentials to clients.
