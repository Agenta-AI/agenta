# WP-8: Rivet + ACP agent runtime

Status: design ready to implement. Start at [`plan.md`](plan.md). Decisions and open
items are in [`status.md`](status.md).

This folder is self-contained. A new engineer should be able to read it and implement the
work end to end without prior context. Read in this order: this README, then
[`context.md`](context.md) (the code that exists today), [`research.md`](research.md)
(verified facts about rivet, ACP, and the pattern we copy), [`architecture.md`](architecture.md)
(the target design), and [`plan.md`](plan.md) (the phased build).

## Summary

Re-platform the agent workflow service (`services/oss/src/agent.py`) so it drives the
agent over the **Agent Client Protocol (ACP)** through [`rivet-dev/sandbox-agent`](https://github.com/rivet-dev/sandbox-agent),
instead of the bespoke Pi JSON protocol it uses today.

The `/invoke` contract does not change. The handler still builds a user turn and returns
`{"role": "assistant", "content": ...}`. What changes is the transport behind the existing
`Harness` port: rivet runs the chosen harness (Pi, Claude Code) as an ACP session and
streams the reply back. Picking a different harness becomes a config value, not new code.

## The four requirements

1. **Drive the agent over ACP**, not the Pi JSON protocol. Rivet speaks ACP to the
   harness; our service drives rivet.
2. **Swap harness as config.** The same agent config runs on Pi or Claude Code by setting
   one value.
3. **Run locally.** The same path runs on a dev machine with no container, using rivet's
   `local` provider. The rivet server is open source, so running it locally is normal.
4. **Defer tools.** Ship with no tools. The tool model is fixed (definition plus swappable
   body, delivered per-harness over MCP), but nothing is built here.

## The design in five lines

- Keep `agent.py`, the `/invoke` contract, and the `Harness` port unchanged.
- Add a `RivetHarness` adapter behind the port, plus a small TypeScript runner that wraps
  the rivet SDK.
- Run **one rivet daemon and one sandbox per invoke** (cold), then tear it down. This
  copies the pattern Agenta already ships for code evaluators.
- Inject the trace context as an environment variable **at the daemon's birth** (the
  sandbox `env_vars` on Daytona, the SDK `env` option locally). No fork of rivet or the
  adapters is needed under this per-invoke model.
- Two axes swap independently: **sandbox** (local, daytona) and **harness** (pi, claude).

## Agent configuration (the contract to rivet: filesystem plus config)

- **AGENTS.md** — instructions, after variable substitution.
- **Input variables** — substituted into AGENTS.md, like prompt-template variables.
- **Skills** — laid into the workspace as files (path and format are per-harness).
- **Tool definitions** — schema only, separate from bodies. Empty here.
- **Harness** — `pi` / `claude`.
- **Sandbox** — `local` / `daytona`.
- **Secrets** — harness and LLM auth, passed as launch env, never written into the
  agent-visible filesystem.

## In scope

ACP transport via rivet, harness swap (Pi and Claude Code), local run, and **tracing**
(the agent's spans must nest under the `/invoke` span; standalone traces are not
acceptable). Daytona and concurrency are described as the immediate follow-on phases.

## Deferred (each its own follow-on)

- **Tools** ([WP-7](../wp-7-tools/README.md)): the definition-plus-body model over MCP.
- **Folder isolation (the jail)**: rivet has no filesystem confinement. Needed only when a
  single warm daemon hosts many agents at once. A TypeScript-or-Rust change, deferred. See
  [`isolation-and-fork.md`](isolation-and-fork.md).
- **Multi-turn and streaming to the client** ([WP-4](../wp-4-multi-message-output/README.md)):
  one turn in, one message out, matching today. A session is persisted message history
  replayed via ACP `session/load`.
- **Standalone SDK runner**: run an agent from the SDK with a config. The adapters are
  written to live in the SDK so this is a packaging step later, not a rewrite.

## Why rivet

Rivet is the thing we were about to hand-build in the `Harness` and `Runtime` ports: an
ACP daemon that drives several harnesses, keyed by session, over a swappable sandbox
(local, daytona) with an HTTP and SSE control plane. We adopt it unmodified (Apache-2.0).
The one capability it lacks, filesystem confinement, we are deferring.
