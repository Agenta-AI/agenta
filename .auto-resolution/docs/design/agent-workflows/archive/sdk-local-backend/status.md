# Status: SDK-owned agent runtime + local backend

Source of truth for this effort and the handoff for whoever continues it. This is the only
page in `docs/design/agent-workflows/` that describes things that do not fully exist yet; the
design pages describe only what is built.

## What this effort is

Two things, layered on the agreed three-layer port redesign (Backend / Environment / Harness
plus neutral and per-harness configs):

1. Move the neutral agent runtime out of the service and into the published Python SDK, so an
   SDK user can download an agent config and run it locally with no Agenta backend.
2. Add a `LocalBackend` that runs a harness on the user's own machine (Pi via a bundled JS
   runner, Claude via the Python `claude-agent-sdk`).

## Current state (2026-06-18)

### Done and verified (by import + wire-equivalence; live `/invoke` not re-run, see below)

- **SDK runtime** at `sdks/python/agenta/sdk/agents/`, hexagonal layout:
  - `dtos.py` — Pydantic data contracts: `AgentConfig` (+ `from_params`), `RunSelection`,
    `SessionConfig`, `Message`, `ContentBlock`, `AgentEvent`, `AgentResult`,
    `HarnessCapabilities`, `HarnessType`, `TraceContext`, `ToolCallback`,
    `HarnessAgentConfig` + `PiAgentConfig` / `ClaudeAgentConfig`.
  - `interfaces.py` — the ports (ABCs): `Backend`, `Environment`, `Sandbox`, `Session`,
    `Harness`.
  - `errors.py` — `UnsupportedHarnessError`.
  - `adapters/rivet.py` — `RivetBackend` (engine hard-coded `rivet`; pi + claude; `sandbox`
    kwarg) + `RivetSandbox` / `RivetSession`.
  - `adapters/in_process.py` — `InProcessPiBackend` (engine hard-coded `pi`; pi only, local
    only; the reference backend) + its sandbox/session.
  - `adapters/local.py` — `LocalBackend`, STUB (raises `NotImplementedError`).
  - `adapters/harnesses.py` — `PiHarness`, `ClaudeHarness`, `make_harness`; this holds the
    per-harness adaptation (tool-spec normalization; Pi keeps built-ins and forces
    `permissionPolicy=auto`; Claude drops built-ins and honors the policy).
  - `utils/wire.py` — `request_to_wire` / `result_from_wire` (the `/run` shape).
  - `utils/ts_runner.py` — `deliver_http` / `deliver_subprocess`.
- **Public surface**: `ag.AgentConfig`, `ag.SessionConfig`, `ag.RunSelection`,
  `ag.Environment`, `ag.RivetBackend`, `ag.InProcessPiBackend`, `ag.LocalBackend`,
  `ag.PiHarness`, `ag.ClaudeHarness`, `ag.make_harness`. `ag.Message` is deliberately the
  prompt type (unchanged); import the agents `Message` from `agenta.sdk.agents`.
- **Service rewired**: `services/oss/src/agent/app.py` builds `AgentConfig.from_params` +
  `RunSelection`, picks a backend via `select_backend`, runs through `Environment` +
  `make_harness`. `tools.py` / `tracing.py` import the SDK `ToolCallback` / `TraceContext`.
  `services/oss/src/agent/inputs.py` and the whole `services/oss/src/harness/` package were
  deleted (their content now lives in the SDK).
- The full `_agent` handler emits a `/run` payload byte-identical to the previous one, so the
  TypeScript runner (`services/agent/`) is unchanged. `ruff format` + `ruff check` pass.

### Not done yet (take over here)

- **`LocalBackend` (the new feature).** Two mechanisms, one per harness:
  - Pi → bundled JS runner. Needs a `pnpm` build step that bundles the in-process Pi engine
    to a single JS file shipped inside the `agenta` wheel, and `LocalBackend` invoking it
    with `node`. (Decision: bundle prebuilt JS in the wheel.)
  - Claude → the pure-Python `claude-agent-sdk`, in-process, no TS bridge. (Decision: use
    `claude-agent-sdk`, not a TS engine.)
  Both need build/dependency setup to verify, which is why they are not started.
- **Live verification.** Everything above is verified by import + wire-equivalence only. A
  real `/invoke` run on the dev stack (pi+local, rivet+pi, rivet+claude, rivet+pi+daytona)
  has NOT been re-run since the refactor. Do this before treating the rewrite as shipped; see
  the `debug-local-deployment` skill.

## Locked decisions

- Vocabulary follows `api/`: `dtos.py` (data), `interfaces.py` (ports/ABCs), `adapters/`
  (implementations). A port is an interface; an adapter is an implementation.
- Backends are NOT a class hierarchy. Each hard-codes its engine id and supported harnesses;
  they share only the `utils` functions. `InProcessPiBackend` is the reference backend.
- DTOs are Pydantic.
- `Harness` (not the backend) owns the per-harness adaptation logic, especially tools.
- Sandbox is a backend/environment concern, not a `SessionConfig` field.
- The TS runner and the `/run` wire stay unchanged.

## Dependency direction

`service -> SDK`, never the reverse. The SDK runtime never calls the Agenta API. The service
resolves tools (`/tools/resolve`), vault secrets (`/secrets/`), and the trace context, and
hands the SDK already-resolved data on the `SessionConfig`. A standalone SDK user resolves
their own (env keys, their own tools, no tracing) and uses `LocalBackend`.
