# Set up provider applications for MCP

Draft documentation for review. The current branch supports the manual-client form. Catalog selection and the `AGENTA_MCP_*` environment settings below are proposed and do not work until the managed-client change ships. Neither provider has completed end-to-end acceptance on this branch.

## Choose a setup path

| Deployment | Who creates the provider application? | What the connecting user does |
| --- | --- | --- |
| Agenta Cloud with managed configuration | Agenta's operator, once per provider and environment. | Select the provider and authorize their account. |
| Self-hosted with managed configuration | The self-hosting operator. | Select the provider and authorize their account. |
| No managed configuration | A person with provider application administration rights. | Enter the application's client ID and secret in Agenta, then authorize. |

An OAuth application identifies the deployment. It does not authorize all users. Every connection still needs the user's consent and the provider's required organization/workspace approval.

## Register the callback

Use the exact callback Agenta reports for the deployment. Its path is `/gateways/mcps/connect/callback` under the public API base. For the usual `/api` prefix, the proposed Cloud callback is:

```text
https://cloud.agenta.ai/api/gateways/mcps/connect/callback
```

Register the public HTTPS address, not an internal container address. Staging uses its own public API base. Confirm the active staging hostname before registering it. Slack requires HTTPS redirects; the current public HTTP test deployment needs HTTPS before Slack acceptance.

## GitHub

Use [GitHub application settings](https://github.com/settings/applications/new), or the organization's Developer settings, with an account allowed to register applications there.

For the initial OAuth App validation path:

1. Create an organization-owned OAuth App with an environment-specific name and homepage.
2. Register that environment's exact callback.
3. Obtain the client ID and generate a client secret in the app settings.
4. Configure the values through one of the paths below.
5. Authorize a test account, then verify tool discovery and an allowed read-only call.

GitHub currently documents up to 10 callback URLs per OAuth App. We still propose separate staging and production applications so rotation and mistakes do not affect both environments.

GitHub recommends GitHub Apps for fine-grained permissions and short-lived tokens. That is an alternative app type, not a claim that the current branch has tested its installation flow. Validate the selected type before documenting it as supported. Organization restrictions can still require administrator approval.

References: [Create an OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [MCP host integration](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md).

## Slack

Open [Slack app settings](https://api.slack.com/apps) with permission to create/manage the app and install it in a test workspace.

1. Create or choose the application for this environment.
2. In **Agents**, enable **Slack Model Context Protocol (MCP) Server**.
3. In **OAuth & Permissions**, configure the user-token scopes needed by the intended MCP tools and register the exact HTTPS redirect.
4. Obtain the client ID and client secret from **Basic Information → App Credentials**.
5. Configure the values through one of the paths below and verify the complete discovered MCP OAuth flow.
6. Before customer rollout, verify distribution eligibility and installation in a second workspace, including its administrator approval requirements.

The [Slack sample guide](https://docs.slack.dev/ai/slack-mcp-server/developing) includes bot events and an in-Slack assistant. Those parts support its sample application and are not automatically Agenta requirements. Agenta needs the MCP-enabled application and an appropriate user token. Do not add bot scopes simply by copying the whole sample manifest.

Slack's MCP metadata selects a user-token OAuth flow. Its general installation guide describes a different bot/user install route. Let discovery select the MCP endpoints and verify their compatibility with the registered app. Do not assume ordinary Slack app creation alone establishes that compatibility.

References: [Develop with Slack MCP](https://docs.slack.dev/ai/slack-mcp-server/developing), [OAuth installation and HTTPS redirect rules](https://docs.slack.dev/authentication/installing-with-oauth), [MCP server tool descriptions and scope requirements](https://docs.slack.dev/ai/slack-mcp-server).

## Operator-managed configuration after implementation

Inject these names through the deployment's secret system into the API service only:

```text
AGENTA_MCP_GITHUB_CLIENT_ID
AGENTA_MCP_GITHUB_CLIENT_SECRET
AGENTA_MCP_SLACK_CLIENT_ID
AGENTA_MCP_SLACK_CLIENT_SECRET
```

Do not put values into git, frontend variables, build arguments, screenshots, chat, or a shared environment file visible to unrelated services. Self-hosters use their own applications and values, never Agenta Cloud's secret.

Restart the API after a configuration update. Both values absent means the manual path is available. A complete valid pair enables managed consent. A partial pair is an operator configuration error. The UI receives only the setup action; it never receives the managed secret.

The initial proposed managed validation profiles are GitHub `read:user` and Slack `users:read`, for limited read-only validation. These are not yet verified complete scope sets for general tool use. Production scope profiles must name the intended tools, required scopes, and verification evidence before release.

## Manual setup on the current branch

Enter the provider's MCP URL and continue. When Agenta reports unsupported automatic registration, copy the callback into the provider application, then enter the client ID and required secret directly in Agenta. The values belong to that project connection; later reads must not reveal the secret.

The current branch shows the form but does not yet include its provider documentation link. That link is part of the proposed work. Do not enter real secrets over a public plain-HTTP deployment. Use an HTTPS test environment before validating actual applications.

## Token alternative

**Use a token instead** opens the existing named-project-secret/header flow. For the direct GitHub and Slack servers, the documented request shape is `Authorization: Bearer <token>`, not a generic `x-api-key` header. Store the value in the named secret and configure the header according to Agenta's verified header handling; acceptance must confirm it does not omit or double-prefix `Bearer`.

GitHub supports personal access tokens with appropriate permissions. Slack's example uses a user token from an MCP-enabled app. A random Slack bot token is not a documented substitute. Token fallback does not bypass provider application enablement, scope, or administrator restrictions.

## Verify and maintain

Test consent, callback completion, tool discovery, an allowed read-only call, reconnect, and token refresh where the provider issues a refresh token. Test refusal and revoked credentials too. Record the application owner, environment, callback, approved scope profile, and last validation date without recording secrets.

For a same-client-ID secret rotation, update the environment's secret and restart the API. Follow the provider's supported overlap procedure, and test in staging first. Replacing the client ID requires reconnecting affected grants. Removing configuration stops later exchanges but does not revoke access tokens already issued by the provider.
