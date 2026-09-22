# Tasks

All implementation is pending review. Use the catalog backend first. Application changes and Cloud secret delivery are separate pull requests; actual provider app creation and credential updates require operator approval.

## 1. Backend client selection

- [ ] 1.1 Add central MCP OAuth environment settings for both providers. Verify unset, complete, partial, whitespace-invalid, and redacted-error cases without changing unrelated provider availability.
- [ ] 1.2 Add one backend setup resolver used by probe and begin, including authorized endpoint context for reconnect. Verify managed/saved/automatic/manual/blocked decisions, conflicting manual submissions, and stale configuration.
- [ ] 1.3 Add reviewed resource, issuer, token-destination, and scope constraints to managed catalog definitions. Verify custom-host impersonation, conflicting URLs, changed issuer, redirected token endpoint, and scope expansion cannot receive a managed credential.

## 2. Callback and grant lifecycle

- [ ] 2.1 Add an optional typed server-owned client reference to attempts and grant settings, with an additive migration where needed. Verify old rows deserialize and round-trip, and browsers cannot author the reference.
- [ ] 2.2 Resolve pinned managed identity at callback and refresh without copying the secret into the vault. Verify stable-ID secret rotation, removed configuration, changed client ID, replayed callback, and cross-project requests.
- [ ] 2.3 Preserve existing manual/dynamic/document grants after enabling managed configuration. Verify reconnect, concurrent refresh, disconnect, and legacy fallback regression tests.
- [ ] 2.4 Add sentinel-secret tests across endpoint reads, probe responses, catalog payloads, errors, traces, and saved project state. Verify the managed secret appears only in authorized server-to-provider authentication.

## 3. Frontend and public documentation

- [ ] 3.1 Render backend setup actions in the shared journey. Verify hidden credential fields when managed, manual fields and docs when absent, blocked partial configuration, and denied-consent recovery.
- [ ] 3.2 Publish GitHub and Slack guides covering both operator and manual paths. Verify registration settings against official docs and a real app; include Slack MCP enablement and HTTPS, callback derivation, permissions, and token-header examples.
- [ ] 3.3 Add optional self-hosting environment examples limited to the API service. Verify rendered Compose configuration excludes these values from frontend/build/runtime workers.

## 4. Cloud deployment companion

- [ ] 4.1 Document the active staging/production stage and secret-store references with the operator. Verify them through existing deployment configuration without printing live secret values.
- [ ] 4.2 Add API-only secret-file delivery using the existing private Cloud deployment pattern. Test extraction from the shared environment, protected file permissions, missing-value behavior, restart, and absence from all non-API services and builds.
- [ ] 4.3 Record separate provider app owners, IDs/references, callbacks, approved scope profiles, validation dates, and rotation/rollback procedure in private operations documentation. Verify no secret values enter git or logs.

## 5. Provider acceptance and rollout

- [ ] 5.1 With approval, provision staging applications and complete both providers' consent, callback, token exchange, tool discovery, a permitted read-only call, reconnect, and applicable refresh tests. Verify the chosen minimal scope profiles before claiming support.
- [ ] 5.2 Test an external organization/workspace and its administrator restrictions. Verify distribution eligibility and safe error messages rather than assuming app creation enables all customers.
- [ ] 5.3 Exercise unset/partial/rotated/removed configuration and application-ID replacement across API restarts. Verify stored grants never switch client identities silently.
- [ ] 5.4 Record exact-commit browser and backend evidence without credential entry. Run focused suites, schema/client generation where applicable, package builds/lints, and diff checks.
- [ ] 5.5 Enable production only with explicit approval and validated rollback steps. Verify correct environment identity and API-only injection before archiving the change.
