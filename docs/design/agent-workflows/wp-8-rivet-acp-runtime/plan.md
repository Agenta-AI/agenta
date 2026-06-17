# Plan

Phased so each phase is demonstrable and reversible. Phases 0 to 2 deliver the four
requirements (ACP, harness swap, local, tools deferred) plus tracing. Phase 3 adds
Daytona. Phase 4 adds concurrency. Keep the legacy Pi adapters working throughout; select
the rivet path with env.

Read [`context.md`](context.md) and [`architecture.md`](architecture.md) first.

## Demo targets (what success looks like)

1. **Sandbox swap:** the same agent on `local` and `daytona`, harness fixed.
2. **Harness swap:** the same agent on `pi` and `claude`, sandbox fixed.
3. **Tracing:** the agent's spans nest under the `/invoke` span in Agenta, for both
   harnesses.

## Phase 0 — Spike: rivet + local + Pi + ACP + tracing (throwaway)

Goal: prove the path end to end before touching the service.

1. Install locally: the rivet SDK and `sandbox-agent` binary (check the package name on
   rivet.dev), the Pi CLI, and the `pi-acp` adapter. Verify the SDK API names against the
   installed version.
2. Write `services/agent/src/runRivet.ts`: `start({ sandbox: local(), env })`,
   `createSession({ agent: "pi", cwd })`, write `AGENTS.md` into `cwd`, `prompt(...)`,
   accumulate `agent_message_chunk` into a string, `destroy()`. Return `{ ok, output,
   sessionId, model }`.
3. Package the `agenta-otel` logic (from `services/agent/src/agenta-otel.ts`) as a Pi
   extension and install it at `~/.pi/agent/extensions`. Pass `traceparent`, the Agenta
   OTLP endpoint, and auth in the `start({ env })` map.
4. Write a `uv run` showcase script (inline `# /// script` deps) that calls `runRivet`
   with a fixed config (AGENTS.md, model), prints the reply, then re-runs with
   `agent: "claude"`.

Done when: Pi answers a prompt locally through rivet over ACP, Claude Code answers the same
config, and Pi's spans show up in Agenta nested under a parent trace.

## Phase 1 — `RivetHarness` behind the port

Goal: wire rivet into the service with no change to `/invoke`.

1. `services/oss/src/agent_pi/rivet_harness.py`: `RivetHarness(Harness)`. Map
   `HarnessRequest` plus `{harness, sandbox}` config and `TraceContext` to a `runRivet`
   `/run` call (reuse the `PiHttpHarness` HTTP-client shape, or stdio).
2. `services/agent/src/server.ts`: route `/run` to `runRivet` when `AGENT_BACKEND=rivet`.
3. `agent.py` `_build_harness()`: add `AGENTA_AGENT_RUNTIME=rivet` to return
   `RivetHarness` (harness from `AGENTA_AGENT_HARNESS`, sandbox `local`). Keep the Pi
   default.
4. Pass `_trace_context()` through `RivetHarness` to `runRivet`, which injects it into
   `start({ env })`.

Done when: `/invoke` returns the same `{"role": "assistant", "content": ...}` for a
no-tools agent via rivet, spans nest under `/invoke`, and flipping `AGENTA_AGENT_RUNTIME`
switches between the rivet and Pi paths with no other change.

## Phase 2 — Harness swap as config

Goal: one config, two harnesses.

1. Thread `AGENTA_AGENT_HARNESS` (`pi` / `claude`) through `RivetHarness` to `runRivet`'s
   `agent` value.
2. Pass harness auth as launch env: Pi's LLM key; Claude Code's Anthropic auth plus
   `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_*`, `TRACEPARENT`, run in `-p`/SDK mode.
3. The `RivetHarness` (the adapter) normalizes `model` per harness (Pi takes the id;
   Claude Code uses its own).

Done when: the same agent config runs on Pi and Claude Code by changing one value, and both
nest spans under `/invoke`. This completes the four requirements.

## Phase 3 — Daytona sandbox (mirror the code evaluator)

Goal: swap `local` for `daytona`, same agent.

1. Build a Daytona snapshot with the rivet binary, the Pi and Claude CLIs, both ACP
   adapters, and the `agenta-otel` Pi extension preinstalled. Record the snapshot id.
2. `runRivet`: when `sandbox=daytona`, `start({ sandbox: daytona({ snapshot, target }),
   env })`. Create ephemeral per invoke, inject `traceparent` and secrets as `env_vars`,
   `destroy()` after. Reuse the config keys `DaytonaRunner` uses (`DAYTONA_API_KEY`,
   `DAYTONA_API_URL`, `DAYTONA_SNAPSHOT`, `DAYTONA_TARGET` in `api/oss/src/utils/env.py`).

Done when: the same agent runs on `local` and `daytona` by changing the sandbox value, with
one ephemeral sandbox per invoke and spans nested.

## Phase 4 — Concurrency and background dispatch

Goal: bound concurrent sandboxes the way evaluations do.

1. Dispatch agent invokes through the existing taskiq worker + Redis-stream pattern if the
   `/invoke` caller allows async; otherwise bound the synchronous path with a shared
   semaphore. Size it to the max concurrent ephemeral sandboxes (mirror
   `DEFAULT_BATCH_SIZE = 10`).
2. Confirm Daytona cost and quota stay within the cap under load; extra invokes queue.

Done when: N concurrent invokes never exceed the configured number of live sandboxes.

## Deferred (own work packages)

- Tools, definition plus body over MCP ([WP-7](../wp-7-tools/README.md)).
- Folder jail ([`isolation-and-fork.md`](isolation-and-fork.md)), needed only with a warm
  shared daemon.
- Multi-turn and client streaming ([WP-4](../wp-4-multi-message-output/README.md)).
- Standalone SDK runner (packaging the adapters into the SDK).

## Validation

- Behavior parity: reuse the WP-2 manual `/invoke` curl check against both the Pi and rivet
  paths.
- Tracing: confirm in Agenta that the agent run appears under the `/invoke` `trace_id`.
- Python edits: `ruff format` then `ruff check --fix` before committing.
- Add unit coverage for `RivetHarness` request mapping once it grows past a thin client.
