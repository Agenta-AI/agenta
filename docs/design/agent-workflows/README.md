# Agent Workflows

Status: context draft. Research and design to follow.

## Summary

Add a new workflow type to the backend: **agents**. Today the backend runs
prompt-style workflows (completion, chat, LLM-as-a-judge). Agents are different. An
agent runs inside a sandbox, executes tools over multiple turns, returns a multi-message
output, and is instrumented end to end. Agents run on a **pi.dev** harness by default,
and the same harness can run locally so a configuration pulled from the server behaves
the same on a developer machine.

This document only captures context. It does not propose a solution yet. The research
topics in [Open research topics](#open-research-topics) will be assigned to subagents and
written up in sibling files.

## What an agent is

An agent is a configured, sandboxed, instrumented runtime that:

- Boots a sandbox through startup hooks that lay down files and inject secrets.
- Runs a harness (pi by default, configurable) that drives the model and its tools.
- Produces a multi-message output rather than a single completion.
- Carries a `session_id` so a run can be identified and, later, have its state stored.
- Emits instrumentation through pi instruments for tracing and observability.

## Agent configuration

The agent configuration is what gets stored on the server, versioned as a workflow
revision, and pulled down to run locally. It includes:

- **`AGENTS.md`** — the agent's instructions.
- **Skills** — the skills available to the agent.
- **Model** — the model the agent runs on.
- **Tools** — the tools the agent has access to.
- **Files** — files that are part of the config and are laid into the sandbox by the
  startup hook.
- **Secrets** — for example an OpenAI key, injected into the sandbox by the startup
  hook.
- **Harness** — which harness runs the agent. Defaults to pi; configurable.

## Runtime model

- **Sandbox.** Agents run in a Daytona sandbox, or any sandbox provider that works with
  our port. The sandbox is initialized by startup hooks: file setup, then secrets setup.
- **Harness.** The harness (pi by default) is the layer that exposes tools and drives the
  agent loop. It is configurable per agent.
- **Output.** A run returns multiple messages, not one completion.
- **Instrumentation.** Runs are instrumented with pi instruments.
- **Sessions.** Each run has a `session_id`. Future work adds session storage alongside
  global storage so session state can persist across runs.

## Local execution parity

The same harness that runs server-side must run locally on pi.dev abstractions (tools and
the rest). A user can pull an agent's configuration from the server and run it locally
with the same behavior. Local-server parity is a first-class requirement, not an
afterthought.

## What the research established

Full write-ups live in [`research/`](research/). The load-bearing conclusions:

- **pi.dev is "Pi"**, an open-source TypeScript/Node agent harness by Earendil Inc. (MIT,
  ~v0.79.4). It is local-first (a CLI/SDK/RPC, not a hosted service) and moves fast (0.x,
  roughly weekly releases). There is no Python SDK.
  See [`research/pi-interaction.md`](research/pi-interaction.md),
  [`research/open-questions.md`](research/open-questions.md).
- **Pi can run fully diskless.** Via the SDK's `createAgentSession`, AGENTS.md
  (`systemPromptOverride`/`agentsFilesOverride`), skills (`skillsOverride`), tools
  (`customTools`), LLM auth (`setRuntimeApiKey` / `AuthStorage.inMemory()` / env), and
  session/settings/model state (`*.inMemory()`) are all in-memory. The only forced disk
  write is bash output spillover to `os.tmpdir()`, redirected with `TMPDIR` to a per-run
  tmpfs. See [`research/diskless-in-memory-config.md`](research/diskless-in-memory-config.md).
- **"pi instruments" is not a product.** Pi emits no OTel by itself. Instrumentation is a
  Pi extension on the `pi.on(...)` event bus that turns lifecycle events into OTLP spans.
  Agenta already ingests OTLP at `POST /otlp/v1/traces` with adapters for GenAI semconv
  and OpenInference, so `gen_ai.*` spans flow with little new backend code. Watch the
  token-attribute drift (`input_tokens`/`output_tokens` vs the mapped
  `prompt_tokens`/`completion_tokens`). See
  [`research/otel-instrumentation.md`](research/otel-instrumentation.md).
- **The harness seam is ours to build.** Pi's own "harness" concept is not a swap point
  for Codex or Claude Code. The recommended shape is a thin TypeScript wrapper that drives
  Pi's SDK with the in-memory overrides above and exposes our own protocol on a port. That
  wrapper is the "works with our port" contract, the swappable-harness boundary, and the
  local/server parity point. See [`research/auth-secrets.md`](research/auth-secrets.md).
- **One shared sandbox is viable for v1.** Daytona supports one long-lived sandbox reused
  across runs. It does not support swapping a volume per execution (volumes mount at create
  time only). Per-run isolation comes from process memory plus a per-run tmpfs, not a
  volume, which the diskless finding makes clean. Concurrency is contended, so bound it.
  See [`research/sandbox-sharing.md`](research/sandbox-sharing.md),
  [`research/daytona-sandbox.md`](research/daytona-sandbox.md).

## POC work packages

The POC runs as parallel tracks. Each has its own folder with scope and a definition of
done. WP-1 and WP-2 run against a local Pi install first (no Daytona). WP-3 takes the
sandbox path in parallel. WP-4 and WP-5 are design tasks that feed the WP-2 interface. WP-6 registers the agent as a
backend workflow type and template, and defines its configuration and connection to the
running agent.

- [`wp-1-pi-tracing/`](wp-1-pi-tracing/README.md) — install Pi locally and send its agent
  telemetry to Agenta as clean, structured traces.
- [`wp-2-agent-service/`](wp-2-agent-service/README.md) — a new service that wraps Pi and
  exposes a completion/chat-style interface, with auth and AGENTS.md set up in memory.
- [`wp-3-daytona-sandbox/`](wp-3-daytona-sandbox/README.md) — create a Daytona sandbox with
  Pi installed, inject files and secrets, run an agent, and stream output back.
- [`wp-4-multi-message-output/`](wp-4-multi-message-output/README.md) — define how an
  agent's multi-message output is shaped, streamed, stored, and surfaced.
- [`wp-5-chat-vs-completion/`](wp-5-chat-vs-completion/README.md) — decide the interface
  contract; start with chat that takes a single input.
- [`wp-6-workflow-type-and-template/`](wp-6-workflow-type-and-template/README.md) — register
  the agent as a new backend workflow type and template; define its config (model) and the
  connection to the running agent.
- [`wp-7-tools/`](wp-7-tools/README.md) — make runnable tools part of the agent config; resolve
  Composio actions into Pi tools and route tool calls back through the existing
  `POST /tools/call`, with MCP and workflow-as-tool as future adapters.
- [`wp-8-rivet-acp-runtime/`](wp-8-rivet-acp-runtime/README.md) — re-platform the service onto
  `rivet-dev/sandbox-agent` so the agent is driven over ACP and the harness (Pi, Claude Code,
  Codex) becomes a config value, running locally first; tools, Daytona, and the folder jail deferred.

## Related work

- [`../prompt-runtime-unification/`](../prompt-runtime-unification/README.md) — the
  prompt-side runtime that "future agent-style services" were already anticipated against.
