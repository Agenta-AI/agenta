# Status

State: DESIGNED v2
Next action: owner second-round review on PR #5288
Last updated: 2026-07-13

## Review round 1 (2026-07-13)

Owner review plus a second reviewing agent converged on a re-scope for the MVP release. All four owner comments were adopted:

- Cut the runner `GET /capabilities` endpoint. API and runner read the same enabled-provider value from one deployment entry (the API already had this pattern via `AGENTA_SANDBOX_LOCAL_ALLOWED`). Deferred as RSH-7.
- Cut the declarative bootstrap manifest. Local subscriptions use an operator-owned read-write Compose mount; runtime customization uses custom images and the existing Daytona snapshot scripts. Deferred as RSH-4.
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
- [x] Phase 2: runner environment narrowing.
- [x] Phase 3: subscription cleanup.
- [ ] Phase 4: hosting layout and public documentation.

## Phases 2 + 3 landed (2026-07-14)

Shipped in `fix/runner-env-narrowing` (stacked on `refactor/runner-config-names`):

- Deleted `shouldUploadOwnLogin` + `uploadPiAuthToSandbox` and their tests. The runner no longer
  discovers its own Pi login and uploads it to a Daytona sandbox.
- `buildRunPlan` rejects Daytona + `runtime_provided`, and rejects a local `runtime_provided` run
  whose subscription mount (`PI_CODING_AGENT_DIR` / `CLAUDE_CONFIG_DIR`) is unset, before any
  sandbox side effect.
- Local `runtime_provided` Pi and Claude runs read and write the operator's read-write mounted
  login DIRECTLY: no per-run copy. The harness refreshes its own OAuth token and the new token
  persists to the mount, so a rotated refresh token no longer breaks the next run. Tradeoff:
  concurrent local subscription runs share the harness config dir (single-trusted-operator path).
- Removed the static `AGENTA_API_KEY` exporter fallback in `tracing/otel.ts`; export auth rides
  the per-run caller credential.
- One structured `mount degraded kind=<k> cause=<c>` warning at each durable-null site
  (session cwd, agent mount, harness transcript). Failure behavior unchanged (RSH-11 still open).
- Helm: `AGENTA_RUNNER_TOKEN` wired via `agentRunner.auth.tokenSecretRef` in
  `runner-deployment.yaml` + `_helpers.tpl` (both ends), values.yaml/schema examples, and a
  rendered-chart secret-absence test (`hosting/kubernetes/helm/tests/`) wired into CI.
- Compose: commented opt-in read-write subscription mount examples on the OSS + EE runner service.

No-ops on this base (deletions already satisfied, nothing to remove): `commonEnv` is absent from
the runner deployment (the #5286 include that would add it is not an ancestor of this base),
`AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS` has zero code occurrences, and
`AGENTA_SESSION_HARNESS_MOUNTS` was already removed from `services/runner/src` in phase 1.

## Deferred to post-release: credentialMode strictness flip

The interface's required-`credentialMode` contract (interface.md section 5) is NOT free on this
base, so the flip is deliberately deferred and this slice keeps the existing inference branch.

The caller audit (research.md / the env-narrowing spec section 9) found one structural path that
omits the field: a **model-less agent template** in the SDK agent handler. When `_agent_model_ref`
returns `None` (`sdks/python/agenta/sdk/agents/handler.py`, model-less template branch), no
`resolved_connection` is threaded, so `wire_resolved_connection()` returns `{}` and the run request
carries no `credentialMode` / `provider` / `deployment`. Every model-configured caller sends all
three via `ResolvedConnection.to_wire()`.

Post-release work to unblock the flip: thread a sentinel `ResolvedConnection` (credential_mode
`"none"`, or `"runtime_provided"` for a self-managed harness) when `model_ref is None` in
`handler.py`, confirm across the matrix, then make `credentialMode` required in `buildRunPlan` and
delete the inference branch. `AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS` is already deleted (no-op).

## Review guidance

The draft PR has inline decision threads on the most consequential choices. Resolve those before implementation. Small naming edits can land directly in this workspace; changes that alter credential movement, remote subscription support, or mount behavior should update the interface, plan, and QA documents together.
