# Current MCP behavior and evidence

Draft source audit, 2026-09-20. Main revision: `5e36059503e8bb76500a7cec2caf5cb86e8ee01d`. Existing implementation revision: `c8e3cfd50359ddb4824a3972f0080ae6abd58318` on `agent/6985-oauth-client-registration`. This document separates observed code and QA from proposed changes.

## What users see today

Main starts **Connect MCP** with a server URL. A probe detects authentication and the shared journey opens consent or asks for a named secret/header. Existing project connections are distinct from entries available to connect. There is no maintained direct-MCP selection catalog in the inspected flow.

The branch adds a callback/client-ID/client-secret form when automatic registration is unsupported. It does not yet provide managed provider applications or a catalog-first screen.

## The registration failure

On main, `_resolve_client_info` tries a compatible saved registration, then dynamic registration. With no registration endpoint and a public HTTPS API address, it uses Agenta's metadata URL without requiring the provider to support client identity documents. That is the defect in [issue #6985](https://github.com/Agenta-AI/agenta/issues/6985).

The branch carries explicit discovery flags and refuses that unsupported assumption. Users can instead supply a registered client. A private/local callback limitation is distinct from a provider that never supports automatic registration.

## Existing code patterns

| Observation | Inspected source |
| --- | --- |
| Composio's catalog uses typed provider/integration data, a service, and provider adapters. | `api/oss/src/core/gateway/catalog/{dtos,service,registry}.py`; `providers/composio/adapter.py`. |
| Tools routes already use catalog/provider/integration vocabulary. | `api/oss/src/apis/fastapi/tools/router.py`. |
| Skills registry items are workflow-backed project records. | `api/oss/src/core/skills/service.py`, `list_registry_skills`. |
| Built-in workflows use a code-defined read-only catalog. | `api/oss/src/core/workflows/static_catalog.py`. |
| MCP registry currently selects upstream adapters, not user-facing integrations. | `api/oss/src/core/gateways/mcps/registry.py`. |
| New connection, reconnect, and in-chat entry points share a journey. | `web/packages/agenta-entity-ui/src/mcpEndpoint/McpConnectJourney.tsx`; entity hook in `@agenta/entities/mcpEndpoint`. |
| Existing grids/gallery patterns can guide presentation. | `web/packages/agenta-settings-ui/src/tools/IntegrationGrid.tsx`; `web/packages/agenta-skills-ui/src/registrySections.ts`. |
| Environment configuration is centralized, and GitHub account login already has its own client settings. | `api/oss/src/utils/env.py`. |
| Attempts bind callback context; grants reference stored registrations for refresh. | `api/oss/src/core/gateways/mcps/oauth/{service,storage,dtos}.py`; `core/secrets/dtos.py`. |

Interpretation for review: copy these organizational conventions into a small MCP-specific catalog. Do not repurpose the transport-adapter registry, Composio connection model, or Skills workflow storage.

## Verified provider documentation

The following are source observations, not proof of successful Agenta authorization.

- [GitHub's host integration guide](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md) states: “Dynamic Client Registration is NOT supported by Remote GitHub MCP Server at this time.” It supports both GitHub Apps and OAuth Apps and recommends GitHub Apps for finer-grained permissions.
- [GitHub's OAuth App creation guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) states: “You can enter up to 10 callback URLs.” The earlier one-callback claim is outdated. Separate environment applications remain an isolation recommendation.
- [Slack's developing guide](https://docs.slack.dev/ai/slack-mcp-server/developing) instructs developers to enable the “Slack Model Context Protocol (MCP) Server” feature in the Agents section. Creating an ordinary Slack app alone is not the whole setup.
- [Slack's OAuth guide](https://docs.slack.dev/authentication/installing-with-oauth) states: “A Redirect URL must also use HTTPS.” The earlier suggestion to register the public HTTP development callback was not suitable guidance.
- Slack's generic app installation guide describes `/oauth/v2/authorize` and `/oauth.v2.access`. Its live MCP metadata advertises `/oauth/v2_user/authorize` and `/api/oauth.v2.user.access`. Do not replace MCP discovery with the generic bot install flow. Real application compatibility with the discovered flow remains an acceptance test.

Live metadata inspected in this session:

| Provider | Metadata URL | Observed identity |
| --- | --- | --- |
| GitHub | `https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp` | Resource `https://api.githubcopilot.com/mcp`; issuer `https://github.com/login/oauth`. |
| Slack | `https://mcp.slack.com/.well-known/oauth-protected-resource` | Resource and issuer `https://mcp.slack.com`. |
| Slack | `https://mcp.slack.com/.well-known/oauth-authorization-server` | No registration endpoint; `client_secret_post`; authorization and token endpoints on `slack.com`. |

## What was tested

The earlier delivery record reports 271 focused backend tests, 22 entity API tests, and 54 rendered journey tests passing at the implementation revision. Package builds/lints and formatting checks also passed. Those tests were not rerun during this documentation-only update.

The isolated deployment ran API/web images labeled with that revision. Recorded browser checks showed both real provider probes, the required manual client fields, disabled submission with missing input, a masked secret input, and the token fallback form. A dummy GitHub client reached the GitHub login page with a PKCE challenge.

That does not prove authorization. GitHub and Slack real-app consent, token exchange, tool access, and refresh remain unverified. Manual token connection was not completed. Eight acceptance tests failed fixture setup because `ag_env` was unavailable. The dummy endpoint and client secret were explicitly deleted, with empty endpoint/secret/attempt counts verified afterwards.

The reported browser 404 was not independently captured. The placeholder client was a likely explanation, not a demonstrated root cause. The specs do not rely on that attribution.

## Remaining code review checks

Before accepting the current fix, test that legacy registration scans cannot select another endpoint's manual client and that deleting an endpoint cleans up its private registration without deleting shared dynamic clients. These are specific open checks from code inspection, not claims that the tests already passed.
