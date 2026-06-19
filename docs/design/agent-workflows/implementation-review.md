# Implementation Review

This is a high-level cleanup review for splitting the agent workflow work into reviewable
PRs. It avoids single-bug detail unless the detail points to a larger design risk.

## Scope Reviewed

- `services/oss/src/agent/`
- `sdks/python/agenta/sdk/agents/`
- `sdks/python/agenta/sdk/decorators/routing.py`
- `sdks/python/agenta/sdk/models/workflows.py`
- `services/agent/src/`
- Agent workflow design docs under this folder

## Findings

### Public SDK Surface Exposes A Stub Backend

`LocalBackend` is exported from `agenta.sdk.agents`, advertised in adapter docs, and listed
as supporting Pi and Claude, but both core methods raise `NotImplementedError`.

This blocks the standalone SDK story and anything in [sdk-local-tools/](sdk-local-tools/)
that assumes local agent execution. It should become either a real backend or a clearly
experimental import path before public docs or examples point users at it.

### Session Protocol Is Ahead Of Persistence

`/messages` and `/load-session` are real routes, and the session id flows through the
runtime. The durable-history side is still missing. `NoopSessionStore` is the default, and
the runtime does not save completed turns to a store.

This is the largest architectural gap because the API shape looks done while the product
behavior is still client-held history. Keep the route, but label it clearly until storage
lands.

There is a second session gap beyond history: future harness session snapshots. The meeting
discussion called out saving state during cleanup and loading it during setup, especially
for Rivet/ACP-style sessions. That is not the same as storing chat messages and should be a
separate design decision.

### Agent Template Boundaries Are Not Stable Yet

The current request shape mixes `AGENTS.md`, tools, MCP config, harness, sandbox, model,
and permissions. That is practical for the POC, but it does not yet define the persisted
agent template.

Before the UI or storage treats templates as durable objects, split generic identity from
harness-specific options and runtime infrastructure. Runtime/sandbox selection should stay
POC-scoped unless product requirements say otherwise.

### Streaming Crosses Several Layers

Streaming now spans generic workflow routing, workflow request models, the Vercel adapter,
the SDK `AgentRun`, runner transports, and TypeScript engine events. The separation is
reasonable, but the blast radius is high.

Keep contract tests around the boundaries:

- Vercel `/messages` HTTP behavior.
- Python-to-TypeScript `/run` wire shape.
- Runner NDJSON event and terminal result records.
- Vercel stream part projection.

### Agenta Harness Is Experimental Product Policy

`AgentaHarness` is wired as a harness type, but its preamble, persona, and skill list are
placeholder product content. It also only works on the in-process Pi path.

Treat this as an experimental harness. It should not be positioned as production until the
forced content is real and the unsupported rivet/Daytona path is either implemented or
hidden from config.

### Tool Resolution Is Cleaner, But The Runtime Matrix Is Uneven

The SDK now owns canonical tool and MCP models, while the service owns Agenta gateway and
vault adapters. That direction is healthy. The remaining runtime matrix is still uneven:

- Code tools can run locally in the runner.
- Callback tools need `/tools/call`.
- MCP resolution is feature-gated.
- Remote MCP servers are skipped by the current runner path.
- Client tools need a browser turn boundary and cannot run headlessly.
- Named tool secrets depend on the vault resolve endpoint and failure policy.

This needs a small matrix in every PR that changes tools, so reviewers know which
combinations are meant to work.

The durable template contract for tools also needs tightening. The intended model is URI,
schema, and execution body or delivery reference, covering builtin Agenta tools, inline code
tools, and MCP placeholders without baking runner-specific delivery details into persisted
templates.

### Triggers Are Missing Meaningful Work

The June 18 discussion treated triggers as a first-class POC area. They need a source event,
a target agent/workflow, a mapping from event JSON to message or request, and lifecycle
management through a provider adapter.

There is no trigger port, Compose.io adapter, Agenta trigger state, or event-to-agent
mapping in the current agent workflow code. This should become its own PR slice rather than
being hidden inside tool or session work.

### MCP Is Visible Before It Is Fully Available

The agent config schema and playground controls expose MCP server configuration. The
runtime path is narrower: service resolution is behind `AGENTA_AGENT_ENABLE_MCP`, Pi reports
no MCP capability, rivet delivers MCP only for non-Pi harnesses, and remote MCP servers are
not executed on the current runner path.

The UI should either surface those constraints or hide MCP controls until the selected
harness/backend can honor them.

### HITL Is Scaffolded, Not Product-Ready

The runner has an interaction responder seam and Vercel stream projection for approval
requests, but the active responder is still a headless `auto` or `deny` policy. There is no
durable session store to hold a pending interaction across turns.

Treat human approval, elicitation, and browser-fulfilled tools as protocol scaffolding until
the cross-turn responder and session persistence land together.

### Historical Work-Package Labels Add Noise

Several implementation comments still refer to WP-2, WP-7, or WP-8. Those labels helped
during the build, but they now make the current architecture harder to read. Replace them
with current names such as "runner sidecar", "callback tools", "rivet backend", or
"Vercel messages route".

### Prompt Override Behavior Differs By Path

Pi `systemPrompt` and `appendSystemPrompt` work on the in-process path. The rivet ACP path
logs that it ignores them. This is documented in the Pi adapter page, but it remains a
product-facing behavior difference under the same harness name.

Decide whether to hide those fields when the selected backend cannot honor them, or keep
the warning and surface it to users.

### Small Cleanup Candidates

- `_normalize_tool_specs` in `sdks/python/agenta/sdk/agents/adapters/harnesses.py` appears
  to be compatibility scaffolding used by tests, not the production runtime.
- Stale names from earlier iterations have already shown up in README and schema comments.
  Keep scanning for similar comments before slicing PRs.

## Suggested PR Slices

1. Documentation and comment hygiene: current docs, trash archive, WP label cleanup.
2. Protocol hardening: `/messages` and Vercel stream tests, error behavior, headers.
3. Agent template contract: identity/config/runtime split, skills serialization, tool
   contract.
4. Session persistence: real `SessionStore`, write path, ownership checks, load behavior.
5. Session snapshot design: Rivet/ACP representation, save/load lifecycle, storage choice.
6. Trigger POC: provider port, Compose.io adapter, event mapping, target invocation.
7. Agenta harness productization: real preamble, persona, skills, and config gating.
8. Local SDK backend: implement or hide `LocalBackend`.
9. Tool matrix cleanup: MCP flag behavior, remote MCP decision, client tool turn boundary,
   named-secret failure behavior.
10. HITL cleanup: decide the responder contract, pending-interaction persistence, and UI
   replay behavior.
