# Agent-config structure cleanup — status

Source: PR #4821 review comments 2 / 7 / 8 (approved).

## What

1. Collapse the run-selection fields (`harness`, `sandbox`, `permission_policy`) from the
   separate `RunSelection` DTO INTO `AgentConfig`. They live under `data.parameters.agent`,
   not as siblings of `agent`. Retire `RunSelection`. (`permission_policy` was later renamed
   `runner.permissions.default`; see [projects/approval-boundary/](../approval-boundary/).)
2. Rename the per-harness options bag `harness_options` -> `harness_kwargs` (a dict keyed by
   harness name; the action-permission field stayed the sidecar's, now inside AgentConfig).

POC: no back-compat, no deprecation shims. Change shapes cleanly.

## Wire impact

NONE at the time. The `/run` payload kept `harness`, `sandbox`, `permissionPolicy` exactly as
before this change: `harness`/`sandbox` were passed to `request_to_wire(harness=, sandbox=)` by
the harness adapter (from `make_harness` + `select_backend`); `permissionPolicy` rode
`wire_tools()` on the per-harness config. This was an envelope/config-placement + parsing
change, not a wire change. Golden fixtures unchanged. (The wire field is now `permissions`;
see [projects/approval-boundary/](../approval-boundary/) for the later redesign.)

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

## State: LANDED (pending PR)
