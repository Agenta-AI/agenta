# MCP execution status

Updated: 2026-09-15.

Product scope is confirmed. This commit records the handoff and target UX; it does not implement the UX, run application QA or establish release readiness.

| Work | Status | Evidence / next action |
| --- | --- | --- |
| Product decisions and handoff | Documented | Read release-decisions-2026-09-15.md and MCP-RELEASE-HANDOFF.md. |
| Current branch baseline and independent flags | Baseline recorded; independent enablement BLOCKED | Head 6df148cb39, base main 236619ebb768. Baseline suites run; no failure is a regression from this PR. No product flag exists for either gateway plane on any layer. The LLM plane cannot be disabled: `sdks/python/agenta/sdk/agents/platform/connections.py` replaced `GET /secrets/` with `POST /gateways/llms/resolve` and raises rather than falling back (`connections.py:1106-1109`), so the non-gateway model path was deleted, not gated. Needs a product decision before dependent work packages proceed. Wallets confirmed absent here (they are on feat/add-wallets at fef84e9118). |
| Multiple accounts and migration | Pending | Implement platform-consistent connection identity. |
| URL-first Connect flow | Pending | Implement mcp-connection-ux.md. |
| Runner per-tool permission wiring | Pending validation | Prove complete flow, then implement. |
| Audit and recovery | Pending | Small fields and failure tests. |
| Automated tests and recorded QA | Pending | Fill mcp-release-gate.md evidence. |
| Astra medium / CodeRabbit feedback loops | Codex runnable; CodeRabbit has a mechanism | Codex gpt-6-astra at medium reasoning is available on this box and verified by a smoke run. CodeRabbit skipped this PR at 518 of 300 files and reported the skip as a passing check. Path-filter-excluded files provably do not count toward the limit (525 changed minus 7 filtered equals the 518 it counted), and CodeRabbit reads config from the head branch, so a temporary `path_filters` block on feat/add-gateways scopes to this PR alone. Two passes: source plus infra (232 files), then tests (about 165). Remove the block before merge. |
| MCP OAuth consent end-to-end | Never executed anywhere | `acceptance/gateways/test_mcp_gateway_oauth_consent_acceptance.py` is skipped in CI because `AGENTA_GATEWAYS_MOCKS_ENABLED` is set nowhere under `.github/workflows/` or `hosting/railway/`, and on the demo stack it fails at fixture setup on a cookie-scheme mismatch. Behind that, the mock MCP server publishes a different resource URL than the address the API dials. |
| MCP release gate | NOT READY | Stop only when all mandatory evidence passes. Current external blockers: the demo stack's ngrok tunnel is down at account quota, which also breaks internal service-to-service calls because `AGENTA_API_INTERNAL_URL` is unset; the Anthropic key has no credit and the mounted Claude login is empty, so no real Claude run is possible; and the LLM-routing premise above needs a decision. |
| LLM SDK and wallet work | Later | Not required to implement for MCP readiness. |

## Decision history

Mahmoud confirmed project-wide multiple accounts, stable slugs/IDs, editable names, configured selection, our own MCP gateway, deferred infrastructure work and phased release. He clarified that LiteLLM SDK applies only to LLM evaluation. He requested the integration-style MCP Connect flow, auditability in this PR and autonomous work through the release-ready gate with Astra medium and CodeRabbit feedback loops.

Name suggestions and authentication discovery use fallbacks because arbitrary server metadata is not guaranteed. No runtime proof has yet validated the target UX.
