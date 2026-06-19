# SDK local tools

This folder plans one feature: letting a standalone Agenta Python SDK user run an agent's
**tools** during a fully local run, with no Agenta backend service and no rivet sidecar.

It complements the sibling effort in
[`../trash/sdk-local-backend/status.md`](../trash/sdk-local-backend/status.md). That one
moves the agent runtime into the SDK and builds `LocalBackend` (the engine that runs a
harness on the user's own machine). This one builds the tool layer on top of that engine:
resolving the agent's tool references into runnable specs, and supplying the secrets those
tools need, all without calling Agenta.

This workspace covers the original feature plan, the organization proposal, its implementation,
and the completed review remediation. `status.md` is the source of truth.

## Read in this order

1. **[context.md](context.md)**: why this matters, the standalone promise it keeps, the
   goal, and the non-goals. Start here.
2. **[research.md](research.md)**: the verified current-state map. Where every piece lives
   today (with `file:line`), what works, and what is missing, broken down per tool kind.
3. **[organization-proposal.md](organization-proposal.md)**: the recommended package,
   naming, exception, validation, and migration structure.
4. **[status.md](status.md)**: the source of truth for progress and the concrete first
   steps for the next agent.
5. **[codebase-conventions.md](codebase-conventions.md)**: repository patterns learned during
   the organization review, including strong precedents and legacy patterns not to copy.
6. **[plan.md](plan.md)**: the earlier phased behavior plan. Its product decisions remain
   useful context; its proposed file and symbol names are not final.

## The one-sentence goal

A standalone SDK user pulls an agent config from Agenta, builds a `LocalBackend`, and runs
the agent locally **with its tools**: built-in, code, and (later) gateway, client, and MCP.

## Prerequisite

This work assumes `LocalBackend` exists. It does not yet; it is a stub that raises (see
research.md). Read `../trash/sdk-local-backend/status.md` for that effort's state. The
phases here are sequenced so the first tool slice lands right after `LocalBackend` does.
