# plan.md – Review Plan

## Strategy

Findings-driven scan (`scan-codebase`, `depth=deep`) over the sdk-local-tools tool-resolution
change set. Rubrics applied: `sdk.md` (the SDK resolver + its public surface), `services.md`
(the server-side orchestration in `tools.py` / `app.py`), `general.md` as the baseline pass,
with `security.md` and `architecture.md` at baseline depth (the change touches secrets and a
service->SDK boundary). All 10 universal criteria applied.

The change set is ~420 lines of meaningful logic across 5 implementation files plus 4 test
files. It sits just under the 400-line split threshold, so it is reviewed as one pass grouped
by risk.

## Pass order (highest risk first)

| # | Pass | Files | Rubric mapping | Budget |
|---|---|---|---|---|
| 1 | Gateway network path + fail-fast | `services/oss/src/agent/tools.py` (`_resolve_gateway`, `resolve_tools`) | services SV-2/6/10, security S-14/15, general G-1/2/3 | done |
| 2 | Local resolver + secret scoping | `tool_resolution.py` (`LocalToolResolver`, `SecretResolver`, spec builders) | sdk SK-3/22/26/27, security S-14, general G-2/3/5/10 | done |
| 3 | Typed error contract | `errors.py` (`ToolResolutionError`) | sdk SK-7/17, general G-7 | done |
| 4 | Public surface + exports | `__init__.py` | sdk SK-7/15 | done |
| 5 | Handler integration | `app.py` (`_agent`, `_agent_stream`) | services SV-2, general G-3/5 | done |
| 6 | Test coverage adequacy | the 4 test files | general G-13..G-17, sdk SK-22 | done |

## Prerequisite automated checks

- Run service agent unit + integration suites: `cd services && uv run python -m pytest
  oss/tests/pytest/unit/agent oss/tests/pytest/integration/agent -n0 -q` — ran, 33 passed.
- Run SDK agents unit suite: `cd sdks/python && uv run python -m pytest
  oss/tests/pytest/unit/agents -n0 -q` — ran, 118 passed.
- Secret-logging scan over the changed + adjacent files — ran, no secret values logged.

## Invariants to verify (from the design)

1. Dependency direction is `service -> SDK` only; the SDK never imports the service.
2. builtin/code/client resolve locally; only gateway hits the network.
3. The service produces identical wire specs (kind/runtime/code/env/callRef/needsApproval/render).
4. MCP is a no-op unless `AGENTA_AGENT_ENABLE_MCP` is set.
5. Secret env is scoped per tool; unresolved secrets are omitted, not errored.
6. Gateway fail-fast paths raise a typed `ToolResolutionError`.

## Deferrals

None. The change set fit one pass within budget.
