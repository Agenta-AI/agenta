# Status

State: DESIGNED
Next action: owner review
Last updated: 2026-07-13

## Completed research

- [x] Read the as-built runner self-hosting explainer and handoff.
- [x] Traced provider selection, Daytona configuration, OAuth upload, Pi installation, and mount fallback in the runner.
- [x] Audited Compose and Helm runner environment injection.
- [x] Reviewed PR #5274 findings.
- [x] Reviewed PR #5285's allowlist and Docker provider plans.
- [x] Reviewed PR #5286's runner token, provider-key narrowing, escape hatch, and Helm `commonEnv`.
- [x] Reproduced the architectural cause of the local 8280 Daytona credential failure.
- [x] Checked official OpenAI terms, account-sharing guidance, and Codex-plan documentation.
- [x] Defined the target environment, Helm, capability, bootstrap, authentication, installation, and mount contracts.
- [x] Defined implementation slices, QA, documentation, and deferred issues.

## Owner decisions requested

- [ ] Approve `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` and `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER`.
- [ ] Approve local-only as the unset enabled-provider default.
- [ ] Approve runner authority plus `GET /capabilities`, instead of every layer reading the same environment variable.
- [ ] Approve the runner-scoped `AGENTA_RUNNER_DAYTONA_*` namespace and separate code-evaluator configuration.
- [ ] Approve no environment aliases because the feature is pre-production.
- [ ] Approve declarative data-only bootstrap version 1.
- [ ] Approve local subscription auth only, with remote subscription combinations rejected.
- [ ] Approve required session, artifact, and transcript mounts failing loudly.
- [ ] Approve removing the static runner `AGENTA_API_KEY` fallback in favor of request-scoped callback credentials.
- [ ] Approve preserving the #5286 runner token and key narrowing while removing `commonEnv` and the inherit-all escape hatch.
- [ ] Approve one trusted all-capabilities runner for local 8280 QA.

## Implementation state

- [ ] Phase 0: local QA and snapshot repair.
- [ ] Phase 1: typed runner configuration.
- [ ] Phase 2: provider capability discovery.
- [ ] Phase 3: narrow runner trust boundary.
- [ ] Phase 4: bootstrap assets and subscription cleanup.
- [ ] Phase 5: required mounts fail loudly.
- [ ] Phase 6: public documentation.

## Review guidance

The draft PR has inline decision threads on the most consequential choices. Resolve those before implementation. Small naming edits can land directly in this workspace; changes that alter credential movement, remote subscription support, or mount failure semantics should update the interface, plan, and QA documents together.
