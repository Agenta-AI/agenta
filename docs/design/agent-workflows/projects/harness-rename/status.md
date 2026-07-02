# Harness rename + legacy in-process backend removal

Status: LANDED (2026-06-24) — code + tests + docs done; on a GitButler lane for human review
(not merged to big-agents).

A contract refactor out of the staff review of the agent-workflow interface inventory. Two
coupled changes, no backward compatibility (the feature is not in production; user confirmed
a hard rename).

## Goal

1. **Remove the legacy in-process Pi backend.** The deployed service already always uses the
   sandbox-agent backend (`app.py` `select_backend` returns `SandboxAgentBackend`). Remove the
   dead in-process path (`engines/pi.ts`) and the `backend` selector field from the wire.
2. **Rename the harness enum values** for clarity:
   - `pi` -> `pi_core`
   - `agenta` -> `pi_agenta`
   - `claude` stays `claude`.

   Both `pi_core` and `pi_agenta` still drive the ACP agent `"pi"`. `pi_core` = plain Pi;
   `pi_agenta` = Pi with forced Agenta skills / prompt / policy.

## Precision note

`agenta` (product/company/package) and `pi` (substring of api, pi.ts, PiHarness, ACP agent
id) are everywhere. Rename ONLY the harness ENUM VALUES and their direct consumers. The ACP
agent id (`acpAgent` = `"pi"`/`"claude"` in the runner) is NOT a harness enum value and stays.

## Slices

- **(a) Remove in-process backend + `backend` field.** Runner: delete `engines/pi.ts`, drop
  the backend branch in `cli.ts`/`server.ts` (always `runSandboxAgent`), drop `AGENT_BACKEND`,
  remove `backend` from `protocol.ts` `AgentRunRequest`, drop `pi` from `version.ts` `ENGINES`,
  fix the stale `SandboxPermission` comment. Python: drop `engine`/`backend` from `wire.py`
  `request_to_wire`, drop `_ENGINE` plumbing + `AGENT_BACKEND` env in `sandbox_agent.py`.
  Delete the runner tests that only tested the in-process path.
- **(b) Rename harness values** across SDK (`dtos.py` enum + RunSelection default,
  `harnesses.py` factory map, `capabilities.py` table, `sandbox_agent.py` supported set,
  `AgentaAgentConfig`), runner (`run-plan.ts` remap, `version.ts` HARNESSES,
  `capabilities.ts` static fallback), service (`app.py`, `schemas.py`), and the catalog type
  (`sdk/utils/types.py` `AgentConfigSchema.harness` Literal + default + description).
- **(c) Golden fixtures + contract tests.** Rename harness values in the goldens, remove
  `backend`, rename `run_request.pi.json` -> `run_request.pi_core.json`. Update
  `test_wire_contract.py` (drop `backend` from KNOWN_REQUEST_KEYS, drop `engine=` args) and
  `wire-contract.test.ts`.
- **(d) Frontend.** Hardcoded `harness: "pi"` -> `"pi_core"` in transport.ts / agentRequest.ts
  + their tests + connectionUtils harness-capability map keys + agentMode/agentRequest tests.
- **(e) Docs.** Run keep-docs-in-sync over the inventory + documentation pages + CLAUDE.md.

## Rename map applied

| old harness value | new harness value |
| --- | --- |
| `pi` | `pi_core` |
| `agenta` | `pi_agenta` |
| `claude` | `claude` (unchanged) |

Wire change: the `backend` request field is REMOVED entirely. The runner always drives the
sandbox-agent engine.

## GitButler

Shared doc files were last touched by PR #4821 (`docs/agent-workflow-interface-inventory`) and
PR #4828 (`chore/agent-remove-load-session`, stacked on #4821). Stack the doc commit on the
load-session lane so GitButler dependency-locks the shared docs. CODE files are clean/independent.
Take BUT-LOCK around each `but` write. Do NOT merge into big-agents (leave for human review).

## What landed

- Removed `services/agent/src/engines/pi.ts` (in-process engine). Runner has one engine:
  `sandbox_agent.ts`. `cli.ts`/`server.ts` always call `runSandboxAgent`; dropped
  `AGENT_BACKEND`/`DEFAULT_BACKEND`. Removed `backend` from `protocol.ts` `AgentRunRequest`.
  `version.ts` `ENGINES = ["sandbox-agent"]`.
- Python: dropped `engine` param + `backend` key from `request_to_wire`; dropped `_ENGINE`
  + `AGENT_BACKEND` env injection in `sandbox_agent.py`.
- Harness rename `pi -> pi_core`, `agenta -> pi_agenta` (claude unchanged): `HarnessType`
  enum values (symbols unchanged), `RunSelection` default, `capabilities.py` table keys,
  `version.ts` HARNESSES, `run-plan.ts` acpAgent remap, catalog type `AgentConfigSchema`,
  service `schemas.py` default, `running/interfaces.py` agent_v0 default, FE
  `connectionUtils.ts` map + `transport.ts`/`agentRequest.ts` defaults.
- Golden `run_request.pi.json` -> `run_request.pi_core.json`; both goldens dropped `backend`.
- Fixed stale protocol.ts SandboxPermission comment (network IS enforced on Daytona).
- Test-only `_in_process_backend.py` -> `_fake_runner_backend.py` (`FakeRunnerBackend`),
  rewired to the current wire (no engine selector). Deleted `pi-provider-env.test.ts`,
  `pi-capability-guard.test.ts`; trimmed `tool-dispatch.test.ts`.
- Docs synced: documentation/ pages, interfaces inventory + README index, services/agent
  AGENTS.md, project status.

## Tests (all green)

- Runner: typecheck clean, 25 files / 160 tests.
- SDK unit: 940 tests. SDK integration (agents transport roundtrip): 4 tests.
- Service agent unit: 29 tests.
- FE: playground 26, entity-ui connectionUtils 18.

## Deferred / notes

- `tracing/otel.ts:830` sets the ACP span `gen_ai.agent.name` from `plan.harness`, so a plain
  Pi run on the non-Pi/Daytona span path now labels the span `pi_core` instead of `pi`. This is
  the precise harness identity (the field is documented as "Harness id"), so left as-is; the
  common Pi path still hardcodes `"pi"` in the Pi-extension tracer. Cosmetic observability only.

## Precision preserved (not renamed)

- Connection mode `Literal["agenta","self_managed"]` (a different concept).
- The ACP agent id `"pi"` (`acpAgent`, `getAgent("pi")`, daemon agent, tracing agent name).
- `RuntimeAuthContext.backend` (the run's backend layer for capability gating, not the removed
  `/run` wire field).

## Scope addition: single-source agent-config default (folded in)

A design review (architecture-followups.md issue 3) found the `agent_config` default was
hand-maintained in three places, each hand-edited by this rename. Collapsed to one builder:

- Added `build_agent_v0_default(*, skill_slug=None, include_sandbox_permission=False)` in
  `sdks/python/agenta/sdk/utils/types.py` (the single source).
- `agenta:builtin:agent:v0` (`engines/running/interfaces.py`) calls it bare (no skill, no
  sandbox_permission).
- The service `_DEFAULT_AGENT_CONFIG` (`services/oss/src/agent/schemas.py`) calls it with the
  two service-only choices as named args (the platform default skill slug + the declared
  sandbox boundary). Removed the duplicated `_DEFAULT_MODEL`/`_DEFAULT_AGENTS_MD` constants.
- Acceptance test `services/oss/tests/pytest/unit/agent/test_default_agent_config.py`: the
  `/inspect` default equals the builder + service choices; it parses into the runtime selection;
  the platform skill + sandbox_permission are present in the service default and intentionally
  absent from the SDK builtin (minimal, harness-agnostic); harness default is `pi_core` in all
  three sources.
- Doc: updated interfaces/public-edge/agent-config-schema.md (Owned by + Watch + default note).
- Left `interfaces/architecture-followups.md` (another session's untracked file) untouched.
