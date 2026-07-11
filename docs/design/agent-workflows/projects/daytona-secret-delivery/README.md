# Daytona secret delivery for agent sandboxes

This workspace evaluates replacing plaintext API keys in Daytona sandbox environment variables
with Daytona Secrets. It is a focused extension of the broader
[`secret-isolation`](../secret-isolation/README.md) project.

## Recommendation

Adopt Daytona Secrets for credentials that a Daytona-hosted agent sends unchanged in outbound
HTTP(S) requests. Create a unique, short-lived Daytona organization Secret for each sandbox and
credential binding, attach it when the sandbox is created, retain it while the sandbox can resume,
and delete it after the sandbox is deleted.

Do not put Agenta API credentials into Daytona Secrets. Keep callback authorization, telemetry
authorization, the Daytona API key, and other Agenta control-plane credentials on the runner side.
Do not copy every Agenta vault secret into Daytona. Resolve only credentials explicitly requested
by the selected model connection, MCP server, or tool.

This mechanism does not support credentials that code must transform or use outside HTTP(S), such
as AWS SigV4 keys, service-account JSON, private keys, database protocol passwords, or secrets used
for local cryptography. Those need an out-of-sandbox gateway or narrowly scoped temporary
credentials.

## Files

- [`context.md`](context.md): problem, goals, threat model, and scope.
- [`research.md`](research.md): current code, Daytona behavior, feasibility, and upgrade risk.
- [`design.md`](design.md): recommended architecture, interfaces, lifecycle, and alternatives.
- [`plan.md`](plan.md): implementation phases and migration sequence.
- [`qa.md`](qa.md): security, compatibility, failure, and live verification matrix.
- [`status.md`](status.md): decisions, blockers, and next action.

## Current state

Planning only. No runtime code or dependency has changed.
