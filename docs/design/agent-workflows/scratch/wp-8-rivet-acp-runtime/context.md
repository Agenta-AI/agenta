# Context: the code that exists today

Read this to orient on the current service before changing it. All paths are in this repo
(`/home/mahmoud/code/agenta`).

## The agent service (WP-2)

`services/oss/src/agent.py` is an Agenta app exposing `/invoke` and `/inspect`, like the
chat and completion services. The handler `_agent(...)`:

1. Resolves config with `_resolve_run_config(...)`: model, AGENTS.md (the system text),
   and tools, from the request `parameters` or the file config.
2. Builds the latest user turn with `_latest_user_message(...)`.
3. Picks a harness adapter with `_build_harness()` and calls the `Harness` port
   (`setup` / `invoke` / `shutdown`).
4. Returns `{"role": "assistant", "content": result.output}`.

Trace context is captured in `_trace_context()` and threaded into the harness so the
agent's spans nest under the `/invoke` span.

## The ports (the seam we keep)

`services/oss/src/agent_pi/ports.py`:

- `Harness` (ABC): `setup()`, `invoke(HarnessRequest) -> HarnessResult`, `shutdown()`.
- `HarnessRequest`: `agents_md`, `model`, `prompt`, `messages`, `tools`, `custom_tools`,
  `tool_callback`, `trace`.
- `HarnessResult`: `output`, `session_id`, `model`.
- `TraceContext`: `traceparent`, `baggage`, `endpoint` (OTLP), `authorization`,
  `capture_content`. Has `to_wire()` (camelCase).
- `Runtime` (ABC): the sandbox/environment seam for the legacy Pi path (`start`,
  `shutdown`, `exec`). The rivet path does not use `Runtime.exec`; it selects a rivet
  provider instead (see architecture).

## The current Pi adapters (legacy, keep working)

- `services/oss/src/agent_pi/pi_harness.py` (`PiHarness`): spawns the TypeScript Pi
  wrapper as a subprocess, one JSON object over stdio.
- `services/oss/src/agent_pi/pi_http_harness.py` (`PiHttpHarness`): POSTs the same JSON to
  the wrapper running as an HTTP sidecar.
- Both send a Pi-shaped envelope (`{agentsMd, model, prompt, messages, tools, customTools,
  toolCallback, trace}`).

## The TypeScript wrapper

`services/agent/` is a small Node service.

- `src/runPi.ts`: turns the envelope into direct Pi SDK calls (`createAgentSession`, ...).
- `src/agenta-otel.ts`: a Pi OTel helper. Today `runPi.ts` imports it in-process and emits
  `invoke_agent` as a child of the incoming `traceparent`. Under rivet this logic must
  become a Pi **extension** installed in the environment (see architecture, tracing).
- `src/server.ts` (HTTP `/run`) and `src/cli.ts` (stdio) are the two transports.

## The pattern we copy: how code evaluators run in Daytona

This is the shipped precedent for "ephemeral sandbox per execution", and the agent service
mirrors it.

- `sdks/python/agenta/sdk/engines/running/runners/` holds `base.py` (`CodeRunner`),
  `local.py` (`LocalRunner`, in-process `exec`), `daytona.py` (`DaytonaRunner`, remote
  sandbox), and `registry.py` (`get_runner()`).
- Selection: env `AGENTA_SERVICES_CODE_SANDBOX_RUNNER` (`local` default, `daytona` in
  cloud).
- `DaytonaRunner.run()` creates an `ephemeral=True` sandbox from a snapshot
  (`DAYTONA_SNAPSHOT`), runs, and deletes it in a `finally`. **One sandbox per execution.**
  No warm pool, no shared instance. It injects `AGENTA_HOST`, `AGENTA_API_KEY`, and the
  user's provider keys as the sandbox `env_vars`.
- Concurrency is bounded by the evaluation engine, not the runner: a shared
  `asyncio.Semaphore(batch_size)` (default 10) in
  `sdks/python/agenta/sdk/evaluations/runtime/processor.py`. So at most ~10 ephemeral
  sandboxes exist at once.
- Daytona config lives in `api/oss/src/utils/env.py` (`DaytonaConfig`:
  `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_SNAPSHOT`, `DAYTONA_TARGET`).

## What we change and what we keep

Change: the transport behind the `Harness` port becomes rivet over ACP, with harness and
sandbox as config values.

Keep: the `/invoke` and `/inspect` contract, the `Harness` port and its dataclasses, the
config resolution in `agent.py`, and the env-driven adapter selection in
`_build_harness()` (extended with a rivet branch). The legacy Pi adapters keep working so
nothing regresses.

## Conventions

- Standalone scripts run with `uv run` and inline `# /// script` dependencies.
- Python edits: `ruff format` then `ruff check --fix` before committing.
- Local-server parity is a first-class requirement carried from WP-2.
