# Context

## Why this work exists

The agent runtime makes one promise. The
[ports-and-adapters](../ports-and-adapters.md) page states it plainly: "Nothing in the SDK
runtime calls the Agenta API, so the same code runs an agent standalone, with no Agenta
backend at all." A developer should be able to pull an agent config from Agenta, then run
that exact agent on a laptop, in a CI job, or inside another product, with no Agenta service
in the loop.

The runtime keeps that promise for everything except tools. A standalone user can build an
`AgentConfig`, pick a harness, and (once `LocalBackend` lands) run a turn. The moment the
agent declares a tool, the promise breaks. Tool resolution lives only in the service, behind
HTTP calls to the Agenta API. So a standalone run either drops the tools silently or cannot
run at all.

This effort closes that gap. It gives the SDK a way to resolve an agent's tools and supply
their secrets locally, so a standalone agent runs *with* its tools.

## The target experience

A standalone user should write roughly this:

```python
import agenta as ag

# 1. Pull the agent config from Agenta (one network call to the public registry).
params = ag.ConfigManager.get_from_registry(app_slug="my-agent")
agent = ag.AgentConfig.from_params(params)

# 2. Build a local engine. No Agenta service, no rivet sidecar.
harness = ag.make_harness("pi", ag.Environment(ag.LocalBackend()))

# 3. Run the agent locally, WITH its tools.
result = await harness.prompt(session_config, messages)
```

Step 3 is impossible today, in two ways. `LocalBackend` is a stub that raises (the sibling
effort owns that). And even with a working `LocalBackend`, nothing in the SDK turns the
agent's tool references into runnable specs or supplies their secrets. This document plans
the second part.

## The standalone definition this hinges on

"Standalone" needs a sharp edge, because the answer shapes the whole design. One open
decision (see [plan.md](plan.md)) is whether a run that calls the Agenta public REST API to
resolve a tool still counts as standalone. We frame the question here so the reader holds it
throughout:

- **Offline-standalone**: the run touches no network except the model provider. Every tool
  resolves from data the user already holds. This is the strict reading.
- **Connected-standalone**: the run uses no Agenta *service deployment* (no rivet sidecar,
  no self-hosted agent service), but it may call the Agenta public API to resolve a tool or
  fetch a secret. This is the loose reading.

Both are useful. The design should let a user pick, not force one. We propose a two-resolver
split that does exactly that, but the reviewer decides (plan.md, Decision 1).

## Goal

Let a standalone SDK user resolve an agent's tools and run them under `LocalBackend`, with a
clear, documented answer for each tool kind: which kinds work fully offline, which need an
opt-in network call, and which stay out of reach for now.

## Non-goals

- **Building `LocalBackend` itself.** The sibling effort
  ([`../trash/sdk-local-backend/status.md`](../trash/sdk-local-backend/status.md)) owns
  the engine. This effort is the tool layer on top of it and assumes it exists.
- **Moving gateway (Composio) execution off the server.** The provider key must stay
  server-side by design. A standalone gateway tool, if supported at all, calls back to
  Agenta; it does not run the provider locally.
- **A new streaming or session model.** Sessions and streaming are covered in
  [`../sessions.md`](../sessions.md) and the agent protocol RFC. This effort changes neither.
- **Shipping every tool kind in the first slice.** The plan sequences kinds by value and
  difficulty; the first slice is deliberately narrow.
