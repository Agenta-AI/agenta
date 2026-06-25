# Agent-config structure cleanup — status

Source: PR #4821 review comments 2 / 7 / 8 (approved).

## What

1. Collapse the run-selection fields (`harness`, `sandbox`, `permission_policy`) from the
   separate `RunSelection` DTO INTO `AgentConfig`. They live under `data.parameters.agent`,
   not as siblings of `agent`. Retire `RunSelection`.
2. Rename the per-harness options bag `harness_options` -> `harness_kwargs` (a dict keyed by
   harness name; `permission_policy` stays the sidecar action-permission, now inside AgentConfig).

POC: no back-compat, no deprecation shims. Change shapes cleanly.

## Wire impact

NONE. The `/run` payload keeps `harness`, `sandbox`, `permissionPolicy` exactly as today:
`harness`/`sandbox` are passed to `request_to_wire(harness=, sandbox=)` by the harness adapter
(from `make_harness` + `select_backend`); `permissionPolicy` rides `wire_tools()` on the
per-harness config. This is an envelope/config-placement + parsing change, not a wire change.
Golden fixtures unchanged.

## Coordination

- Stacked on `feat/agent-model-picker` (#4839), the config/FE tip.
- Did NOT touch `services/agent/**` (sibling HTTP-MCP impl active there).
- `sandbox` stays (sibling sidecar-uri-config replaces it with `uri` AFTER this); structure
  left easy for that. Did NOT edit the sidecar-uri-config project workspace.

## Test results

- SDK agents: 342 passed (`-n0`).
- service-agent: 38 passed.
- FE playground: 121 passed (agentRequest 19, incl. new nested-under-agent test); entity-ui: 126.
- entity-ui + playground typecheck (turbo build) green; oss touched files (transport.ts) typecheck
  clean (pre-existing unrelated baseline errors only). ruff + prettier + eslint clean.
- Codex (xhigh) reviewed: runtime sound, `/run` wire unchanged; flagged the `SessionConfig`
  docstring "sandbox absent" claim (now reworded, since `sandbox` rides on `agent` but is read
  before the session is built and no adapter consumes it).

## Deferred

- `services/agent/src/protocol.ts:354` still has a `harness_options` doc comment (describes the
  Python-side bag). In the runner dir (sibling HTTP-MCP impl active there) so NOT touched here;
  rename to `harness_kwargs` in a runner-owned change.

## State: LANDED — PR #4840 (base feat/agent-model-picker), READY, not merged to big-agents.
