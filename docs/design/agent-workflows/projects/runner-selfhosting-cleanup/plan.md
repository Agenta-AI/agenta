# Implementation plan

The design lands as a short sequence of narrow PRs sized for the MVP release. The release needs stable public names, a clean hosting layout, and honest docs. It does not need new subsystems. Behavior rewrites (capability discovery, bootstrap manifests, fail-loud mounts) are deferred to open issues.

## Phase 0: repair local QA and the merged snapshot regression

Goal: restore a trustworthy 8280 test environment before larger refactors.

### Changes

- Fix the Compose empty-string snapshot regression from PR #5274.
- Remove the dead `AGENTA_AGENT_SANDBOX_DAYTONA_SNAPSHOT` line.
- Point the 8280 deployment at one trusted development runner.
- Give that runner the Daytona provisioning credential.
- Keep local Pi and Claude login inputs read-only and explicit.
- Remove or stop the two ad hoc runner services after the unified runner passes the matrix.
- Record the exact local setup without committing personal credentials.

### Acceptance

- One runner health endpoint is used by Services.
- Local Pi subscription and local Claude subscription work.
- Daytona Pi and Daytona Claude work with managed API keys.
- A Daytona request no longer reaches a runner that lacks Daytona credentials.
- No subscription file is uploaded to Daytona.

This phase may use the current names temporarily to unblock QA, but it must not add new compatibility variables.

## Phase 1: canonical names and typed runner configuration

Goal: one parse-and-validate boundary inside the runner, and the final public names everywhere. This is the open interface we cannot change after release, so it is the center of gravity.

### Changes

- Add a `RunnerConfig` module with typed server, providers, Daytona, callback, and lifecycle sections.
- Rename provider and Daytona variables to the contract in [interface.md](./interface.md).
- Delete old variables and compatibility branches.
- Default enabled providers to local only.
- Validate configuration before the HTTP server listens.
- Make the default provider come from typed config instead of scattered `process.env` reads.
- Pass explicit Daytona configuration to the SDK client.
- Remove `AGENTA_AGENT_SANDBOX_PI_INSTALLED`; probe and repair Pi.
- Rename the API-side gate: `AGENTA_SANDBOX_LOCAL_ALLOWED` becomes the same `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` / `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER` pair, parsed with the same rules ([interface.md section 4](./interface.md)). Compose, Helm, and Railway feed API and runner from one operator-facing entry.
- Update unit tests to cover unset, explicit empty string, invalid ids, default mismatch, missing credentials, and mutually exclusive artifact configuration.

### Files and surfaces

- `services/runner/src/config/*` or one equivalent focused module.
- `provider.ts`, `run-plan.ts`, `server.ts`, session identity and pool readers.
- `api/oss/src/utils/env.py` and the SDK/services readers of the local-allowed gate.
- Compose files and environment examples in OSS and EE.
- Helm schema, values, runner template, secrets, and tests.
- Railway runner scripts.
- Runner README and Docker image documentation.

### Acceptance

- All provider selection reads the typed object.
- No old agent-runner Daytona name remains in code, hosting, or docs.
- Enabling Daytona without a key fails startup.
- Adding an unknown provider id fails startup.
- The default must be enabled.
- A request for a disabled provider fails before side effects with an explicit error.
- Existing provider tests include the Compose empty-string case.

## Phase 2: runner environment narrowing

Goal: reconcile the #5286 audit fixes with the runner trust boundary, without a strictness flip that can break the release.

### Changes

- Keep the shared runner token and constant-time verification.
- Keep clear-then-apply for managed credentials and provider-specific key narrowing.
- Delete `AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS`.
- Remove `agenta.commonEnv` from the Helm runner deployment if #5286 lands it; add a dedicated runner environment helper that injects only approved fields.
- Remove the static `AGENTA_API_KEY` exporter fallback and use the request-scoped caller credential for callbacks and traces.
- Audit every in-repo caller (playground, workflows, evaluations, SDK local) for `credentialMode`, provider, and deployment. If all send them, make the fields required and delete the inference branch in this phase. If any caller omits them, fix the caller here and land the strictness flip immediately after the release.
- Assert in rendered-chart tests that database, auth, cryptographic, Redis, store-master, and unrelated provider secrets are absent from the runner deployment.

### Acceptance

- A local OpenAI run cannot read an Anthropic key from its harness environment.
- A local harness cannot read Postgres, Agenta cryptographic, or bucket-wide store credentials from the runner process.
- Managed credentials remain per run.
- Daytona infrastructure credentials are blanked from every harness environment.
- The caller audit result is recorded in status.md with the decision it produced.

## Phase 3: subscription cleanup

Goal: replace automatic credential discovery with explicit operator mounts. This is a deletion plus documentation, not a new subsystem.

### Changes

- Remove `shouldUploadOwnLogin`, `uploadPiAuthToSandbox`, and their fallback tests.
- Reject Daytona `runtime_provided` authentication with an actionable error.
- Local `runtime_provided` runs read the operator's mounted subscription state; the runner copies it to a per-run directory so harness writes never touch the source.
- A local `runtime_provided` run without the matching mount fails with an error naming the missing configuration.
- Add commented Compose examples for Pi and Claude subscription source mounts.
- Remove `AGENTA_SESSION_HARNESS_MOUNTS`; transcript mounts derive from the session contract.
- Add one structured warning log when a durable mount degrades to an ephemeral directory ([interface.md section 8](./interface.md)). No other mount behavior changes.

### Acceptance

- No code reads an operator home directory to find credentials.
- Local Pi and Claude subscription runs work only with an explicit mount.
- A Daytona run never receives subscription state.
- Harness writes affect only the per-run copy.
- Mount degradation appears in logs with kind and cause.

## Phase 4: hosting layout and public documentation

Goal: make the hosting tree and the docs self-explanatory. Docs depend only on the phase 1 names, so this phase starts as soon as phase 1 is merged and lands with the release.

### Changes

- Add `hosting/README.md` mapping the layout: Compose variants per edition and image mode, Helm, Railway, the runner image built from `services/runner/docker/`, the Daytona snapshot recipe in `services/runner/sandbox-images/daytona/`.
- Add a commented entry for every canonical runner variable to every `env.*.example`.
- Rewrite the self-host docs per [documentation-plan.md](./documentation-plan.md).
- Add a removed-name gate: a grep check that no removed variable name survives under `hosting/` or `docs/`.

### Acceptance

- Every documented variable appears in the runtime and hosting examples.
- Every runtime variable is either documented or intentionally internal.
- Tutorial commands pass against a clean Compose deployment.
- Daytona guides use managed API keys only.
- The docs do not imply local isolation or remote subscription support.
- Search finds no removed variable in `hosting/` or public docs.

## Deferred (open issues, not release work)

- Runner `GET /capabilities` and platform capability discovery: [RSH-7](./open-issues.md). One shared env value replaces it in version 1.
- Declarative bootstrap-asset manifest, hooks, plugins, VPN setup: [RSH-4](./open-issues.md). Read-only mounts and custom images replace it in version 1.
- Fail-loud required mounts: [RSH-11](./open-issues.md). The degradation warning log gathers the data first.
- The credentialMode strictness flip, if the phase 2 caller audit finds an omitting caller.

## Proposed PR stack

1. `fix(runner): repair agent snapshot selection and local QA routing`
2. `refactor(runner): canonical runner configuration names and typed config`
3. `fix(hosting): narrow the runner deployment environment`
4. `docs(self-host): agent runner docs and hosting layout`

PRs 2, 3, and 4 touch mostly disjoint files and can be built in parallel. PR 4 merges last so docs match the merged names.

## Landing order with open PRs

- PR #5274 is already merged. Phase 0 addresses its immediate follow-ups.
- PR #5285 is docs-only. This design supersedes its allowlist contract but keeps its capability-based provider direction for future Docker work.
- PR #5286 can land independently if needed. Preserve its runner token and key narrowing. Remove broad `commonEnv` and the inherit-all flag in phase 2.
