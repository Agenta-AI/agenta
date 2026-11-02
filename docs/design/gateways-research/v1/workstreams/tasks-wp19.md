# WP19 — tasks

1. **Backend: raise the scope challenge.**
   `core/gateways/mcps/types.py::MCPScopeInsufficientError` gains optional `endpoint_id`.
   `core/gateways/mcps/service.py::relay` gains `_parse_scope_challenge` (RFC 6750
   `WWW-Authenticate` parse) and the step 5b detection branch: `custom` + `OAUTH` + `403` +
   an `insufficient_scope` challenge raises, everything else passes through unchanged.

2. **Backend: the connect affordance.**
   `apis/fastapi/gateways/mcps/proxy.py::_map_gateway_exception`'s `scope_insufficient`
   branch attaches `data.connect` when `endpoint_id` is present, pointing at WP18's connect
   route's discover step.

3. **Frontend: repoint the MCP branch.**
   `useGatewayConnectFlow.ts`: `resolveCustomMcpEndpoint`, wire `MCPConnectDialog` into
   `runConnect`/settle for a resolved `custom` endpoint, keep the catalog-drawer fallback for
   an unresolved (`builtin`) target. `GatewayConnectToolWidget.tsx`: mount `MCPConnectDialog`
   alongside the existing `ProviderDrawer` branch.

4. **Tests.**
   - `test_gateways_mcp_service.py`: 4 new cases (scope+list, scope+empty, no-challenge
     passthrough, none-scheme passthrough).
   - `test_gateways_mcp_proxy.py`: 2 new cases (no `endpoint_id` → no `connect`; with →
     `connect` present).
   - `gateway-error-harness-formats.test.ts`: `scope_insufficient` added to `MCP_REFUSALS`.
   - `useGatewayConnectFlow.test.ts`: `resolveCustomMcpEndpoint` cases.

5. **Docs.** `specs-wp19.md` (this package's scope, written before code, per procedure) +
   this file.

## Explicitly not built (see specs-wp19.md "Out of scope")

- Header-first AS discovery, `MCPAuthRequiredError` wiring, a new `AgentErrorDetail`
  frontend consumer, any LLM-plane scope concept.
