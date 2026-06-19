# findings.md – Confirmed Findings

Sync metadata: scan-codebase, `depth=deep`,
`path=docs/design/agent-workflows/sdk-local-tools/review/`, branch `gitbutler/workspace`.
Severity scheme: critical / high / medium / low / info (harness `deliverables.md`). Each
finding also carries `Confidence` and `Status` from the shared findings schema.

## Summary

Six findings were identified and all six are resolved by the tools package refactor.

There are no critical findings. There are no high findings.

## Resolved Findings

### F-001 [RESOLVED] – Gateway orthogonal-axis carry-back (needsApproval / render) is untested

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Status | resolved |
| Origin | scan |
| Lens | verification |
| Category | Testing, Completeness |
| Criteria | general G-13/G-16 (Testing); Completeness (2) |
| Location | `services/oss/src/agent/tools.py:138`; `services/oss/tests/pytest/integration/agent/test_resolve_tools_http.py:47-85` |
| Files | tools.py, test_resolve_tools_http.py, test_tool_refs.py |

**Condition:** `_resolve_gateway` calls `attach_orthogonal(entry, tool)` on every resolved
gateway spec (`tools.py:138`), so a gateway tool that declares `needs_approval` or `render`
should carry `needsApproval` / `render` onto its `kind="callback"` wire spec. No test sets
those fields on a gateway tool. The integration fixture `_GATEWAY`
(`test_resolve_tools_http.py:22`) is a bare picker slug with no orthogonal fields, and
`test_tool_refs.py` only exercises `_gateway_ref` (which does not apply the orthogonal axes —
those land later in `_resolve_gateway`). The gateway branch of `attach_orthogonal` is therefore
never executed under test.

**Cause:** The test that locks orthogonal carry-back
(`test_resolve_tools_splits_builtin_code_client_offline`) covers only the local code/client
kinds. The gateway integration tests focus on the network path, count mismatch, and
incomplete-spec handling, and skip the approval/render axes.

**Consequence:** A regression that drops `needsApproval` on a gateway tool (for example a
human-in-the-loop Composio action) would ship green. Approval is a safety gate; silently
dropping it on the gateway kind is the worst kind to lose, because those tools execute
server-side with the provider key.

**Evidence:** evidence/gateway-orthogonal-untested.md

**Suggested Fix:**

- **Option A (preferred):** Extend `test_resolves_gateway_and_remaps_to_wire_shape` to pass a
  gateway tool dict carrying `needs_approval: true` and a `render` dict, and assert the resolved
  callback spec carries `needsApproval` and `render`. A typed gateway dict
  (`{"type": "gateway", ...}`) is the cleanest vehicle.
- **Option B:** Add a focused unit test in `test_tool_refs.py` that calls `_resolve_gateway`
  with a stubbed HTTP response and a gateway def with the axes set, asserting carry-back by
  position.

**Resolution:** `test_gateway_metadata_and_description_fallback_are_preserved` and
`test_gateway_specs_are_joined_by_call_ref_not_position` cover metadata carry-back.

---

### F-002 [RESOLVED] – Gateway HTTP/timeout failures are raised but not logged

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | high |
| Status | resolved |
| Origin | scan |
| Lens | verification |
| Category | Observability |
| Criteria | Observability (10); services SV-26 |
| Location | `services/oss/src/agent/tools.py:97-120` |
| Files | tools.py |

**Condition:** `_resolve_gateway` makes an outbound HTTP call to `POST /tools/resolve` with no
`try/except` around the `httpx` call and no log on any failure path. A network error (DNS,
connection refused, timeout) raises a raw `httpx` exception, not a `ToolResolutionError`, and
nothing is logged. The HTTP-status, count-mismatch, and incomplete-spec paths raise
`ToolResolutionError` but emit no log line either.

**Cause:** The module logs only the unsupported-provider skip (`tools.py:165`). The gateway call
leans on the exception message reaching the caller, but the caller (`app.py:91`) does not catch
or log it. The adjacent secret resolver (`secrets.py`) wraps every `httpx` call in `try/except`
with a `log.warning` plus `exc_info`; the gateway path does not follow that established pattern.

**Consequence:** When gateway resolution fails in production, the operator sees a generic
framework error with no structured breadcrumb, and a raw `httpx.ConnectError` /
`httpx.ReadTimeout` is not normalized to the typed `ToolResolutionError` the rest of the path
promises. The invariant "gateway fail-fast paths raise a typed `ToolResolutionError`" does not
hold for transport-level failures.

**Evidence:** evidence/gateway-no-logging.md

**Suggested Fix:**

- **Option A (preferred):** Wrap the `httpx` POST in `try/except httpx.HTTPError` and re-raise as
  `ToolResolutionError("Tool resolution request failed: ...")` so transport failures match the
  typed-error invariant. Add `log.warning("agent: gateway tool resolution failed for %d
  ref(s)", len(gateway_defs), exc_info=True)` on the failure paths, mirroring `secrets.py`.
- **Option B:** At minimum add a `log.warning` on the HTTP-status, count-mismatch, and
  incomplete-spec branches so each fail-fast leaves a breadcrumb, and leave transport-error
  normalization for a follow-up.

**Resolution:** `AgentaGatewayToolResolver` logs each failure branch and wraps
`httpx.HTTPError` as `GatewayToolResolutionError`; integration tests verify both.

---

### F-003 [RESOLVED] – Handler does not handle ToolResolutionError; stream path may surface it differently

| Field | Value |
|---|---|
| Severity | medium |
| Confidence | medium |
| Status | resolved |
| Origin | scan |
| Lens | verification |
| Category | Completeness, Soundness |
| Criteria | Completeness (2); services SV-2 |
| Location | `services/oss/src/agent/app.py:91-92` |
| Files | app.py |

**Condition:** `_agent` calls `resolve_tools` (and `resolve_mcp_servers`) at lines 91-92, before
it branches on `stream`. A `ToolResolutionError` raised here propagates straight out of `_agent`.
For the JSON `/invoke` path this is the intended fail-fast: the workflow wrapper turns the raised
exception into an error response. For the SSE `/messages` stream path, the exception is raised
from the coroutine the endpoint awaits to obtain the async generator, so the failure surfaces as
a coroutine raise, not as a stream `error` part. The two paths report the same root failure
through different channels, and there is no test asserting the stream path on a resolution
failure.

**Cause:** Tool resolution is deliberately hoisted above the `stream` branch so both paths
fail-fast before any backend setup. That is the right call for fail-fast, but it leaves the
stream-path error-surfacing shape unspecified and untested.

**Consequence:** A client on the streaming endpoint may receive a transport-level error instead
of a well-formed UI Message Stream `error` part, depending on how the endpoint adapter handles a
raising coroutine. This is a UX inconsistency on the failure path, not a data-loss bug.

**Evidence:** evidence/handler-resolution-error.md

**Suggested Fix:**

- **Option A:** Confirm with the endpoint-adapter author how a raising `_agent` coroutine is
  rendered on the `/messages` SSE path. If it is not a clean stream `error` part, catch
  `ToolResolutionError` for the stream branch and emit an error part.
- **Option B:** Add a handler-level test that drives `_agent(stream=True)` with a `resolve_tools`
  stub that raises `ToolResolutionError`, asserting the documented surfacing shape.

**Resolution:** the protocol requires pre-stream failures to remain JSON. The messages route
now preserves batch error responses before applying streaming negotiation. SDK routing and
service handler tests cover both layers.

---

### F-004 [RESOLVED] – description default differs between code tools and gateway tools

| Field | Value |
|---|---|
| Severity | low |
| Confidence | high |
| Status | resolved |
| Origin | scan |
| Lens | verification |
| Category | Consistency |
| Criteria | Consistency (3); general G-7 |
| Location | `sdks/python/agenta/sdk/agents/tool_resolution.py:103`; `services/oss/src/agent/tools.py:133` |
| Files | tool_resolution.py, tools.py |

**Condition:** `code_tool_spec` sets `"description": tool.description or tool.name`
(`tool_resolution.py:103`) and `client_tool_spec` does the same (`:117`). The gateway path sets
`"description": spec.get("description")` (`tools.py:133`), which can be `None`. So a code/client
tool with no description ships its name; a gateway tool with no backend description ships `None`.

**Cause:** The SDK builders default to the name; the gateway remap copies the backend field
verbatim.

**Consequence:** Low. The TS runner already defaults `description ?? name` when building Pi/MCP
tools (`services/agent/src/engines/pi.ts:162`, `mcp-server.ts:67`), so a `None` description is
absorbed downstream. The only visible effect is a slightly different wire payload for the same
"no description" condition across kinds, which contradicts the "identical wire specs" framing for
the description field specifically.

**Evidence:** evidence/description-default-inconsistency.md

**Suggested Fix:**

- **Option A:** In `_resolve_gateway`, default the description to the resolved name:
  `"description": spec.get("description") or name`, matching the SDK builders.
- **Option B:** Leave as-is and document that `description` may be `None` on the gateway wire
  spec, relying on the runner default.

**Resolution:** gateway specs now use `description or name`.

---

### F-005 [RESOLVED] – attach_orthogonal mutates its argument in place and also returns it

| Field | Value |
|---|---|
| Severity | low |
| Confidence | high |
| Status | resolved |
| Origin | scan |
| Lens | verification |
| Category | Soundness, Consistency |
| Criteria | Soundness (4); sdk SK-3 |
| Location | `sdks/python/agenta/sdk/agents/tool_resolution.py:89-96` |
| Files | tool_resolution.py |

**Condition:** `attach_orthogonal(entry, tool)` mutates `entry` in place (sets
`entry["needsApproval"]` / `entry["render"]`) and returns the same dict. It is a public helper
(imported by the service at `tools.py:36`). The mutate-and-return pattern is easy to misuse: a
caller that reuses the input `entry` after the call sees it mutated, and the return value invites
the false belief that the input is untouched.

**Cause:** Shaped for the call sites that always do `return attach_orthogonal(entry, tool)` with
a fresh `entry`, where in-place mutation is harmless.

**Consequence:** Low. All three current call sites pass a freshly-built `entry` and use the
return value, so there is no live bug. The risk is latent and the dual contract is slightly
inconsistent with a package whose other builders return fresh dicts.

**Evidence:** evidence/attach-orthogonal-mutation.md

**Suggested Fix:**

- **Option A:** Make it pure — `return {**entry, **extras}`. Removes the latent footgun at no
  real cost.
- **Option B:** Keep in-place mutation but drop the return value and name it
  `_attach_orthogonal_inplace`, signalling the contract.

**Resolution:** canonical spec construction uses immutable Pydantic models and
`model_copy`; the legacy helper returns a copied dictionary.

---

### F-006 [RESOLVED] – app.py redundantly re-assigns resolved.mcp_servers

| Field | Value |
|---|---|
| Severity | info |
| Confidence | high |
| Status | resolved |
| Origin | scan |
| Lens | verification |
| Category | Consistency, Complexity |
| Criteria | Complexity (5); general G-9 |
| Location | `services/oss/src/agent/app.py:91-92` |
| Files | app.py, tools.py |

**Condition:** `_agent` does `resolved = await resolve_tools(...)` then immediately
`resolved.mcp_servers = await resolve_mcp_servers(...)`. `resolve_tools` already returns
`ResolvedTools` with `mcp_servers=[]` (documented to leave MCP empty), so the handler overwrites
a field that is empty by construction, relying on an implicit contract.

**Cause:** MCP resolution is intentionally a separate call (different flag gate), so the handler
stitches the two results together.

**Consequence:** None functionally. Minor readability cost and a coupling that would silently
double-resolve if `resolve_tools` ever started populating `mcp_servers`.

**Evidence:** evidence/app-mcp-reassign.md

**Suggested Fix:**

- **Option A:** Provide a single `resolve_all(tools, mcp_servers)` in `tools.py` that returns a
  fully-populated `ResolvedTools`, keeping the two flag gates internal.
- **Option B:** Leave as-is; add a one-line comment that `resolve_tools` never sets
  `mcp_servers`, making the contract explicit at the call site.

**Resolution:** `resolve_agent_resources` returns a complete `ResolvedAgentResources` value and
the handler performs no post-resolution mutation.

## Open Findings

None.
