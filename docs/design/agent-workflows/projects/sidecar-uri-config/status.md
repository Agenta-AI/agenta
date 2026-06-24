# Status

## State

- **IMPLEMENTED.** Spun out of PR #4821 review comment
  [3469613625](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469613625); design
  reviewed in PR #4836, then built per the reviewer's D7 decision.
- Built on [#4840](https://github.com/Agenta-AI/agenta/pull/4840) (config-structure cleanup),
  which retired `RunSelection` and put the run-selection fields on `AgentConfig`. The original
  plan/research below were written against `RunSelection`; the field now lives on `AgentConfig`.

## Decisions taken

- **D1 — `uri` lives on `AgentConfig`** (was `RunSelection` in the original design; #4840 retired
  that class). It is *where a run goes*, parsed in the one `AgentConfig.from_params`.
- **D2 — Not a `/run` wire field.** `uri` is consumed entirely service-side in `select_backend`;
  the runner never receives it. Golden wire fixtures stay byte-identical.
- **D3 — Precedence: `agent_config.uri` (validated) → `AGENTA_AGENT_RUNNER_URL` → local CLI.**
  Unset `uri` is exactly today's behavior.
- **D4 — Allowlist gate, default-off.** `AGENTA_AGENT_RUNNER_URI_ALLOWLIST` (default empty = every
  override rejected). A rejected override fails loud (no silent fallback). Origin match (not
  substring), `http`/`https` only. See [security.md](security.md).
- **D5 — No back-compat / migration.** Pre-production POC.
- **D7 (reviewer) — `uri` REPLACES `sandbox`.** The `sandbox` field is removed from `AgentConfig`,
  `AgentConfigSchema`, `build_agent_v0_default`, and the FE control. The sidecar address drives
  routing; each sidecar picks its own sandbox provider (local/Daytona) from its own env
  (`SANDBOX_AGENT_PROVIDER`). No per-run sandbox selector remains.

## What changed (this PR)

- **SDK** (`sdks/python/agenta/sdk/agents/dtos.py`): removed `AgentConfig.sandbox`, added
  `uri: Optional[str]`; `_parse_run_selection` parses `uri` (trim-or-`None` via `_clean_uri`,
  not case-folded); docstrings updated.
- **SDK schema** (`sdks/python/agenta/sdk/utils/types.py`): removed the `sandbox` field +
  `_DEFAULT_SANDBOX` from `AgentConfigSchema`; added an optional `uri` field; `build_agent_v0_default`
  no longer emits `sandbox` (and omits `uri`, so the default config carries no routing override).
- **Service** (`services/oss/src/agent/config.py`): `AGENTA_AGENT_RUNNER_URI_ALLOWLIST`,
  `runner_uri_allowlist()`, `validate_runner_uri()`, `resolve_runner_url()`, and the typed
  `UnsupportedRunnerUriError`.
- **Service handler** (`services/oss/src/agent/app.py`): `select_backend` routes by
  `resolve_runner_url(agent_config.uri)` and sends a constant `sandbox="local"` default;
  `RuntimeAuthContext.backend` no longer set from `sandbox`.
- **FE**: removed the sandbox `EnumSelectControl` from `AgentConfigControl.tsx`; dropped the
  `sandbox` default in the playground request builder (`agentRequest.ts`) and the dead `sandbox`
  arm of the agent-mode heuristic (`selectors.ts`). No `uri` control is surfaced (operator/testing
  concern).
- **Tests**: SDK `test_dtos_agent_config.py`, service `test_select_backend.py` (full allowlist +
  precedence matrix) and `test_default_agent_config.py`, FE `agentMode.test.ts` /
  `agentRequest.test.ts`. Wire-contract golden untouched (proves `uri` is not on the wire).
- **Docs**: `agent-config-schema.md`, `agent-service-handler.md`, `service-to-agent-runner.md`,
  `running-the-agent.md` (new env var), and this workspace.

## Deferred

- **Wire-level `sandbox` removal.** The `/run` wire still carries a constant `sandbox: "local"`
  the unchanged runner defaults correctly on. Fully removing the field would force a
  `protocol.ts` / golden / runner-branch change, so it is left as a runner-branch follow-up
  (this slice is config/service/FE only and keeps the golden unchanged, per POC scope).
- The deeper transport hardening (auth token, TLS, scoped tokens) stays in the
  [sidecar-trust-and-sandbox-enforcement](../sidecar-trust-and-sandbox-enforcement/) project.

## Resolved open questions

- **O1 (allowlist as the gate)** → yes, `AGENTA_AGENT_RUNNER_URI_ALLOWLIST`, default-off.
- **O2 (loopback implicit?)** → no implicit loopback; even `127.0.0.1` must be listed
  (uniform "nothing trusted" default).
- **O3 (playground-visible?)** → API-only; the playground surfaces no `uri` control.
- **O4 (reject vs silent fallback)** → reject (fail loud), confirmed.
- **O5 (field/env name)** → `uri` on the config, `AGENTA_AGENT_RUNNER_URI_ALLOWLIST` for the gate.
