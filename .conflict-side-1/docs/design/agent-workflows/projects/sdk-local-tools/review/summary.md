# summary.md – Review Summary

## Overview

**Reviewed:** the sdk-local-tools tool-resolution change set (see `scope.md`): the new SDK
`LocalToolResolver` / `SecretResolver` / `ResolvedTools` / spec builders
(`tool_resolution.py`), the typed `ToolResolutionError` (`errors.py`), the SDK exports
(`__init__.py`), the refactored server-side orchestration (`services/oss/src/agent/tools.py`),
the handler that consumes it (`app.py`), and the four accompanying test files.
**Goals:** verify the design invariants hold; surface correctness, soundness, completeness,
consistency, security, and testing findings; confirm the prior conventions review's two gaps are
closed.
**Constraints:** verification-oriented scan (`depth=deep`); runtime validation limited to the
two named pytest targets; no live LLM/runner/backend.
**Review type(s):** sdk + services + general baseline, with security and architecture at
baseline depth.
**Date range:** 2026-06-19 – 2026-06-19.

---

## Health verdict

> **PASS — CONDITIONS RESOLVED**

All review findings and the architecture risk were addressed in the subsequent organization
refactor. The canonical implementation now lives in `agenta.sdk.agents.tools`, MCP is a sibling
subsystem, the service uses explicit gateway/vault adapters, and the runner file names describe
dispatch and callback responsibilities.

Validation after the fixes:

- SDK agent/routing tests: 146 passed.
- Service agent unit/integration tests: 34 passed.
- API unit tests: 859 passed.
- TypeScript tool dispatch/bridge/MCP tests: 3 passed.
- TypeScript extension bundle: built successfully.

---

## Key findings

### Critical and high severity

- None. There are no critical findings and no high findings.

### Medium severity

- **F-001 resolved:** gateway approval/render metadata is tested, including a reordered
  multi-tool response.
- **F-002 resolved:** HTTP failures are logged and normalized to
  `GatewayToolResolutionError`.
- **F-003 resolved:** failures before stream creation remain JSON error envelopes with their
  original HTTP status; routing and handler tests pin this contract.

### Low / info severity

- **F-004 resolved:** gateway descriptions default to the resolved name.
- **F-005 resolved:** canonical spec construction is immutable; the unshipped compatibility
  helper and former flat modules were removed.
- **F-006 resolved:** `resolve_agent_resources` returns tools and MCP resources in one result.

### Positive observations

- All six invariants verified: service->SDK dependency direction (the SDK never imports the
  service), local resolution for builtin/code/client with only gateway on the network, wire-spec
  parity with the TS `ResolvedToolSpec` contract (kind/runtime/code/env/callRef/needsApproval/
  render), MCP gated off by `AGENTA_AGENT_ENABLE_MCP`, per-tool scoped secret env with
  omit-on-missing, and typed `ToolResolutionError` on the gateway count/incomplete fail-fast
  paths.
- The two prior conventions-review gaps are closed: `ResolvedToolSet` is a Pydantic model, and
  the service raises a typed `ToolResolutionError(RuntimeError)` (so existing `except
  RuntimeError` callers keep working) carrying structured `status` / `ref_count` / `spec_count`.
- Secrets are scoped per tool and never logged (only secret *names* appear in warnings); the
  union-resolve-then-filter approach correctly prevents cross-tool env leakage.
- Test design is honest: the cross-harness handler test asserts both identical bodies *and*
  divergent per-harness configs at the backend boundary, avoiding the tautology the comment calls
  out; the integration suite covers the gateway count-mismatch and incomplete-spec fail-fast.
- Both suites pass: SDK agents unit 118 passed; service agent unit + integration 33 passed.

---

## Key risks

- **R-001 mitigated:** gateway responses are joined to configs by normalized `call_ref`, not
  response position.

---

## Open questions

- **Q-001 answered:** pre-stream failures use JSON errors; only failures after streaming begins
  become SSE error parts.
- **Q-002 answered:** ordering is no longer trusted; the existing `call_ref` is the correlation
  identity.

---

## Coverage and metrics

| Metric | Value |
|---|---|
| Files in scope | 9 (5 implementation + 4 tests) |
| Files reviewed | 9 |
| Coverage | 100% |
| Critical findings | 0 |
| High findings | 0 |
| Medium findings | 3 |
| Low findings | 2 |
| Info findings | 1 |

---

## Recommended next steps

No review remediation remains.
