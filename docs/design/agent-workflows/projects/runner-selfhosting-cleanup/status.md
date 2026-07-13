# Status

State: DESIGNED v2
Next action: owner second-round review on PR #5288
Last updated: 2026-07-13

## Review round 1 (2026-07-13)

Owner review plus a second reviewing agent converged on a re-scope for the MVP release. All four owner comments were adopted:

- Cut the runner `GET /capabilities` endpoint. API and runner read the same enabled-provider value from one deployment entry (the API already had this pattern via `AGENTA_SANDBOX_LOCAL_ALLOWED`). Deferred as RSH-7.
- Cut the declarative bootstrap manifest. Local subscriptions use an operator-owned read-only Compose mount; runtime customization uses custom images and the existing Daytona snapshot scripts. Deferred as RSH-4.
- Cut the fail-loud mount rework. Version 1 keeps best-effort behavior plus one structured degradation warning. Deferred as RSH-11.
- Confirmed customization is owned by the operator through scripts and images, not runner environment machinery.

Round 1 also added:

- The credentialMode strictness flip is now conditional on a caller audit (phase 2).
- A hosting-layout workstream: `hosting/README.md`, env.example coverage, removed-name grep gate (phase 4).
- Docs land with the phase 1 rename, not after all phases; the documentation plan now carries per-page dispositions from a full audit of the 20 existing self-host pages.
- `SANDBOX_AGENT_LOG_LEVEL` added to the rename list as `AGENTA_RUNNER_LOG_LEVEL`.

The managed-deployment migration is assessed in a private working note outside this repository; it is a small rename delta, not new infrastructure.

## Owner decisions confirmed in round 1

- [x] `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` and `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER`.
- [x] Local-only as the unset enabled-provider default.
- [x] Shared environment value instead of `GET /capabilities` (owner comment; endpoint deferred).
- [x] Runner-scoped `AGENTA_RUNNER_DAYTONA_*` namespace; separate code-evaluator configuration.
- [x] No environment aliases because the feature is pre-production.
- [x] Subscription mounts instead of a bootstrap manifest (owner comment; manifest deferred).
- [x] Local subscription auth only; remote subscription combinations rejected.
- [x] Best-effort mounts with a degradation warning (owner comment; fail-loud deferred).
- [x] Remove the static runner `AGENTA_API_KEY` fallback in favor of request-scoped callback credentials.
- [x] Preserve the #5286 runner token and key narrowing; remove `commonEnv` and the inherit-all escape hatch.
- [x] One trusted all-capabilities runner for local 8280 QA.

## Owner decisions requested (round 2)

- [ ] Approve the v2 re-scope as a whole (phases and 4-PR stack in [plan.md](./plan.md)).
- [ ] Approve the documentation dispositions and new page set in [documentation-plan.md](./documentation-plan.md).
- [ ] Approve the conditional credentialMode strictness flip (audit first, flip only if free).

## Implementation state

- [ ] Phase 0: local QA and snapshot repair.
- [ ] Phase 1: canonical names and typed runner configuration.
- [ ] Phase 2: runner environment narrowing.
- [ ] Phase 3: subscription cleanup.
- [ ] Phase 4: hosting layout and public documentation.

## Review guidance

The draft PR has inline decision threads on the most consequential choices. Resolve those before implementation. Small naming edits can land directly in this workspace; changes that alter credential movement, remote subscription support, or mount behavior should update the interface, plan, and QA documents together.
