# scope.md – Review Scope

## Objectives

- Verify the sdk-local-tools tool-resolution change set preserves its design invariants:
  dependency direction `service -> SDK`, local resolution of builtin/code/client, network only
  for gateway, identical wire specs across paths, MCP gated off by default, per-tool scoped
  secret env with omit-on-missing, and typed `ToolResolutionError` on gateway fail-fast paths.
- Surface correctness, soundness, completeness, consistency, security, and testing findings in
  the changed files, judged against the surrounding code they integrate with.
- Confirm the two gaps flagged by the prior conventions review are resolved (Pydantic
  `ResolvedTools`, typed error) and that the tests lock the behaviour they claim to.

## Codebase / branch

| Field | Value |
|---|---|
| Repository | agenta (monorepo) |
| Branch / commit | `gitbutler/workspace` (working tree; scope files are new vs `main`) |
| Review type | combination: sdk + services + security (baseline) + architecture (baseline) |

## Inclusions

Implementation:

- `sdks/python/agenta/sdk/agents/tool_resolution.py`
- `sdks/python/agenta/sdk/agents/errors.py`
- `sdks/python/agenta/sdk/agents/__init__.py`
- `services/oss/src/agent/tools.py`
- `services/oss/src/agent/app.py`

Tests:

- `sdks/python/oss/tests/pytest/unit/agents/test_tool_resolution.py`
- `services/oss/tests/pytest/unit/agent/test_tool_refs.py`
- `services/oss/tests/pytest/unit/agent/test_invoke_handler.py`
- `services/oss/tests/pytest/integration/agent/test_resolve_tools_http.py`

## Exclusions

Read for integration judgement only, not reviewed as scope:

- `sdks/python/agenta/sdk/agents/dtos.py` (`SessionConfig`, `ToolCallback`), `tool_defs.py`,
  `adapters/harnesses.py`
- `services/oss/src/agent/secrets.py`, `services/oss/src/agent/client.py`
- `services/agent/src/protocol.ts` and the TS runner tool builders (wire-shape consumers)
- All other unrelated workspace changes on the branch.

## Constraints and assumptions

- Scope files are new on this branch; there is no `main` baseline to diff against, so
  "identical wire specs" is judged as cross-path identity (local vs server-side), which the
  tests assert, plus parity against the TS `ResolvedToolSpec` contract.
- Review is verification-oriented (scan-codebase, `depth=deep`). Runtime validation is limited
  to the two named pytest targets; no live LLM, runner, or backend was exercised.

## Stakeholders

| Role | Name / Team |
|---|---|
| Requestor | mahmoud@agenta.ai |
| Author(s) | agent-workflows contributors |
| Reviewer(s) | `agent` (scan-codebase, code-review harness) |
| Decision owner | mahmoud@agenta.ai |

## Timeline

| Milestone | Target date |
|---|---|
| Review start | 2026-06-19 |
| Final deliverables | 2026-06-19 |

## Success criteria

- Every in-scope file read in full and judged against the 10 universal criteria.
- All design invariants explicitly confirmed or flagged.
- Findings carry severity, confidence, real `file:line`, evidence, and ≥1 remediation.
- Both named test suites run and their pass/fail recorded.

## Approval

Requestor reviews `summary.md` + `scorecard.md` and closes the review.
