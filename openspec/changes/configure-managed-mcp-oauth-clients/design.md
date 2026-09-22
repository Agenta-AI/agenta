# Design: managed MCP applications

Draft. Not implemented. Technical choices below are recommendations for review.

## Context

See [proposal.md](proposal.md) for the Cloud and self-hosting experience. The current patch can store a manual OAuth client in a project vault, the existing secret store. It does not read deployment-managed MCP clients. The catalog follow-up supplies trusted provider identities.

The current callback consumes an OAuth attempt and reloads its registration; refresh follows a grant's `client_registration_slug`. A managed application cannot simply be inserted at begin without defining those later reads. Copying the managed secret into every project's vault would undermine deployment-only ownership.

## Goals / Non-Goals

**Goals:** One application per provider per environment, no credential fields for ordinary configured connections, fallback when unconfigured, and explicit ownership across authorization, callback, and refresh.

**Non-goals:** A client-credential administration UI, a new secret manager, sharing Cloud secrets with self-hosting customers, an OAuth proxy for self-hosters, or automatic provider application creation.

## Decisions

### Central environment configuration owns managed values

Add an MCP OAuth configuration group to `api/oss/src/utils/env.py`, consumed through the existing `env` object. Define explicit GitHub and Slack client-ID/secret fields using the names in the specification. Do not reuse `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`, which configure Agenta account login.

Both absent means unconfigured. A complete pair is eligible for managed use. A partial pair produces an integration-specific configuration error, not a global API startup failure or a silent manual fallback. Secrets use redacted types and never appear in validation errors. Configuration takes effect on API restart; no live-edit service is needed.

### Separate catalog data, credential configuration, and setup results

Use a backend resolver shared by probe and begin. It reads catalog trust data, endpoint history where available, discovery, and managed configuration. The browser does not choose a credential source or send a managed client ID.

Proposed additive probe field:

```json
{
  "auth": {
    "mode": "oauth",
    "registration": "unsupported",
    "client_setup": {
      "action": "consent",
      "source": "managed",
      "callback_url": "https://cloud.agenta.ai/api/gateways/mcps/connect/callback",
      "documentation_url": "<published provider guide>"
    }
  }
}
```

`registration` still reports the provider's automatic registration support. `client_setup` describes what the person must do now. For a manual form, return `action: enter_client` with `client_secret_required`. For a setup error, return `action: blocked` with a stable reason and safe message. `source` on consent is `managed`, `saved`, or `automatic`. No response needs a stored client ID or secret.

This is an API contract proposal, not a claim that the field exists. The authorization URL necessarily contains the public client ID; the secret never belongs there. Add an endpoint-aware setup read or optional endpoint context to the probe so reconnect can obtain a truthful decision without exposing the saved registration. It must check project ownership before reading endpoint history.

The UI renders these actions. Old backends without the additive field retain the current generic flow. Deploy the backend before the new UI; keep managed values unset until the new UI is present. Begin re-resolves the decision and returns a typed setup/configuration-changed error when the earlier result is stale. It never trusts a browser boolean such as `managed: true`.

### Use deterministic selection without changing existing grants

For an existing endpoint, preserve its recorded client source and identity. For a new connection:

1. Resolve a trusted catalog integration and complete managed configuration. Use its managed client.
2. Otherwise accept the manual client when the user is in the manual path, or reuse a compatible stored registration for that endpoint.
3. Otherwise use the existing dynamic-registration or explicitly supported metadata-document behavior.
4. If none applies, request a manual application with documentation, or report the specific setup limitation.

Reject a new manual credential submission that conflicts with a managed decision rather than silently ignoring it. Existing manual endpoints remain manual on reconnect unless an explicit future migration is approved. Enabling a Cloud app is not a migration of old grants.

### Pin the client reference, not the secret

Extend the OAuth attempt and grant settings with an optional typed client reference. A managed reference records `source: managed`, the stable integration key, and the public client ID used to start consent. A stored registration reference keeps the current vault registration slug. An explicit document reference distinguishes metadata identity from legacy rows.

Reuse existing issuer, redirect URI, and token endpoint attempt fields. Only the managed reference is new required context for managed paths. It is server-owned protocol state, never part of user-authored endpoint metadata. Add an additive nullable database field for attempts if the current persistence cannot carry it; the JSON grant settings remain backward compatible. Do not promise a migration-free managed implementation.

At callback, compare the current managed client ID with the pinned one, validate the pinned destination against the catalog, then resolve the current secret. At refresh, repeat those checks using the grant reference. Missing configuration or a changed client ID fails safely with operator-repair/reconnect guidance. Do not fall through to a metadata-document client.

Rotating a secret for the same client ID reads the new value after restart. Replacing the application ID is a reconnect operation, not transparent rotation. The first version does not add multiple concurrently configured client generations. Legacy grants without the new reference retain their existing resolver; cover that path with tests rather than infer a managed identity from an issuer match.

### Trust the resource and destination together

Do not use an issuer-to-secret dictionary on its own. A user-controlled server can advertise GitHub's issuer. Managed selection requires the catalog-approved server address and discovered resource/issuer pair. Token destinations also have an exact reviewed HTTPS origin/path allowlist, checked for exchange and refresh. Do not follow a redirect carrying client credentials to a different origin.

For example, Slack currently advertises resource and issuer `https://mcp.slack.com`, but its token endpoint is on `https://slack.com`. A same-host rule would be wrong; a reviewed explicit relationship is appropriate. Continue discovery rather than replacing it with hardcoded authorization behavior, then validate the returned destinations against that relationship. If a provider moves, fail with an actionable unsupported-configuration result until its catalog entry is reviewed.

Keep existing server-side request forgery protections, project permission checks, expiring state, and Proof Key for Code Exchange (PKCE), which binds the authorization code to the initiating client. Managed credentials do not broaden who can connect or which tools an agent may call.

### Constrain scopes separately from advertised capabilities

A server's advertised scopes are not permission to request all of them. Add a reviewed scope policy to each managed definition. A conservative initial validation profile is GitHub `read:user` and Slack `users:read`, with tool access limited accordingly. Validate those profiles with real applications; if a provider requires additional minimum scopes, document evidence and review that exact expansion before enabling it. Broader read/write tool profiles are a separate explicit product choice, not silently inferred from metadata.

The generic manual path retains current scope behavior. The managed path intersects its reviewed profile with discovery and blocks missing required scopes instead of quietly widening access. No new scope-picker UI is required in this version.

### Reuse the current Cloud secret delivery with API-only injection

Repository inspection found an existing environment-specific Secrets Manager pull step in the private Cloud delivery repository. Its Compose file gives multiple services a shared environment file. A separate API-only env-file pattern already exists for another backend credential. Follow that pattern for MCP values: remove them from the shared payload, write a protected API-only file, and mount it only for the API. Verify both runtime and build environments with redacted presence checks.

Do not store live values in either repository. The infrastructure repository's older staging/production secret paths differ from the Cloud deploy script's stage-based path. The operator must confirm the active account, region, stage, and secret reference before enabling each environment; this plan does not modify infrastructure or read live secret values. Detailed private locations remain in the private operator appendix, not this public proposal.

Self-hosting examples use optional environment variables injected only into the API. Without them, users get the manual form. A registered public HTTPS callback is the documented path for both environments; the existing plain-HTTP development URL is not a Slack acceptance environment.

## Risks / Trade-offs

- Provider-specific application approval can block consent. Verify actual application and workspace eligibility before Cloud enablement.
- GitHub recommends GitHub Apps for finer-grained permissions. The current manual patch matches the OAuth App path. Start its validation there; describe the app choice honestly and do not claim GitHub App installation support without testing it.
- Credential rotation during an in-flight authorization can fail. Retain provider-supported overlap for the same application or ask the user to retry. Changing the application ID requires reconnect.
- Catalog trust checks can reject legitimate endpoint changes. This is preferable to forwarding a deployment secret to an unreviewed destination.
- Shared environment files can leak credentials to unrelated services. API-only injection and rendered-config tests are release requirements, not optional hardening.

## Migration Plan

1. Land the catalog/backend and optional client-reference fields without managed values enabled.
2. Deploy backend setup decisions, callback/refresh handling, and backwards-compatibility tests.
3. Deploy UI action rendering and publish the provider guides before enabling managed values.
4. Add API-only secret delivery in a separate Cloud pull request. Provision staging apps with explicit approval and validate both providers using HTTPS.
5. Provision separate production apps and values only after acceptance. Test a customer organization/workspace before broad distribution.

Rollback must keep managed-reference readers for existing grants, or explicitly disconnect those grants before reverting further. Do not roll back to code that might mistake a managed grant for a metadata-document grant. Removing environment values disables managed exchange/refresh and is not token revocation. Document provider revocation separately.
