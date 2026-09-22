# Design: registered OAuth client support

Draft documenting the existing branch implementation, with acceptance work still open.

## Context

See [proposal.md](proposal.md) for the user-visible failure. The backend already separates endpoint configuration, OAuth attempts, client registrations, and per-endpoint token grants. The shared frontend journey already supports URL probing, consent, and manual header credentials.

## Goals / Non-Goals

**Goals:** Correct registration detection and let users supply an existing provider application without exposing its secret through reads.

**Non-goals:** A provider catalog, Cloud-owned applications, deployment environment settings, automatic app creation, or an assertion that GitHub and Slack consent has passed.

## Decisions

### Use discovery rather than a provider-name workaround

`oauth/client.py` carries `client_id_metadata_document_supported` and token endpoint authentication methods into `MCPOAuthDiscovery`. `probe.py` and `_resolve_client_info` check explicit support. Dynamic registration keeps priority. Unsupported and unavailable describe different problems.

Hardcoding GitHub and Slack as exceptions would miss the next provider with the same limitation. The generic metadata check covers that class of servers.

### Accept credentials only at begin

`MCPOAuthClientInput` contains `client_id` and optional `SecretStr` client secret. `MCPConnectRequest.oauth_client` is accepted with the begin request, not the callback completion. Request validation hides rejected secret values.

The UI shows the callback and required input. It sends credentials once and clears input state. It does not persist these values in agent configuration. The callback remains bound to the stored attempt and authenticated initiator.

### Reuse the vault with a connection-specific registration key

User-provided registrations use issuer, callback, and endpoint identity. Dynamic registrations retain issuer-and-callback sharing. Grants retain their registration association for refresh. This avoids a new credential table and preserves the existing token storage model.

The branch chooses `none` when no secret is supplied and the issuer permits public clients. With a secret it selects `client_secret_basic` when that is advertised without `client_secret_post`; otherwise it selects post. Providers with only unsupported methods require additional review before claiming compatibility.

### Keep one UI flow

The form remains in `McpConnectJourney`. The existing entity hook passes the optional begin input. **Use a token instead** enters the existing header/project-secret screen. It does not assert that any arbitrary token works.

## Risks / Trade-offs

- Manual app registration adds onboarding work. The managed-client proposal addresses that separately.
- The existing storage fallback scans legacy registrations. Review that it cannot reuse a different endpoint's manually supplied registration when the intended one is absent.
- Endpoint deletion currently drops the grant. QA explicitly deleted its test client secret separately. Automatic cleanup of endpoint-specific registrations is not established; verify and fix this before claiming complete credential lifecycle support.
- The UI token form defaults to `x-api-key`. GitHub and Slack examples require `Authorization: Bearer <token>`. Document and test the actual header path.
- Earlier QA used placeholder credentials. A provider login page proves initiation, not callback, token exchange, refresh, or tool access.

## Migration Plan

No schema migration is included in the current patch. Existing dynamic registrations and grants remain readable. Rollback removes the new form and unsupported classification but does not delete vault rows. Do not deploy rollback as a way to revoke provider credentials.

Before acceptance, run real-provider testing over HTTPS, check manual-registration lifecycle isolation, and retain the focused regressions. Leave the change active until these tasks pass and Mahmoud approves it. Do not archive it merely because the code exists.
