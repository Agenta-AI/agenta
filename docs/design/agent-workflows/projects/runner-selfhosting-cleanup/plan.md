# Implementation plan

The design lands as a sequence of narrow PRs. Each slice leaves the current behavior testable and avoids mixing runner configuration, credential movement, mount semantics, and public docs in one review.

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

## Phase 1: typed runner configuration

Goal: create one parse-and-validate boundary inside the runner.

### Changes

- Add a `RunnerConfig` module with typed server, providers, Daytona, bootstrap, callback, and lifecycle sections.
- Rename provider and Daytona variables to the contract in [interface.md](./interface.md).
- Delete old variables and compatibility branches.
- Default enabled providers to local only.
- Validate configuration before the HTTP server listens.
- Make the default provider come from typed config instead of scattered `process.env` reads.
- Pass explicit Daytona configuration to the SDK client.
- Remove `AGENTA_AGENT_SANDBOX_PI_INSTALLED`; probe and repair Pi.
- Update unit tests to cover unset, explicit empty string, invalid ids, default mismatch, missing credentials, and mutually exclusive artifact configuration.

### Files and surfaces

- `services/runner/src/config/*` or one equivalent focused module.
- `provider.ts`, `run-plan.ts`, `server.ts`, session identity and pool readers.
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
- Existing provider tests include the Compose empty-string case.

## Phase 2: provider authority and honest discovery

Goal: keep provider availability in one authority while giving Services and web accurate options.

### Changes

- Add authenticated runner `GET /capabilities`.
- Keep `GET /health` limited to process health and protocol identity.
- Add a Services capability client with bounded timeout, short cache, and explicit unavailable state.
- Generalize the Services provider gate to the runner's discovered enabled set.
- Expose deployment capabilities from an authenticated platform endpoint.
- Filter the web sandbox picker from that endpoint.
- Keep the runner's pre-side-effect execution gate as the final authority.
- Remove `AGENTA_SANDBOX_LOCAL_ALLOWED` and all browser environment derivations for it.

### Acceptance

- Local-only deployment shows only local.
- Local-and-Daytona deployment shows both and can choose either per run.
- A disabled provider is rejected even if a client manually sends it.
- Runner unavailability is distinct from a disabled provider.
- No API, Services, or web process parses the runner enabled-provider environment variable.

## Phase 3: preserve #5286 security gains without broad inheritance

Goal: reconcile the v7 audit fixes with the runner trust boundary.

### Changes

- Keep the shared runner token and constant-time verification.
- Make required run metadata explicit and remove the un-migrated-caller inference.
- Keep clear-then-apply for managed credentials.
- Keep provider-specific inheritance for runtime-provided local runs.
- Delete `AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS`.
- Remove `agenta.commonEnv` from the Helm runner deployment if #5286 lands it.
- Add a dedicated runner environment helper that injects only approved fields.
- Remove the static `AGENTA_API_KEY` exporter fallback and use the request-scoped caller credential for callbacks and traces.
- Assert in rendered-chart tests that database, auth, cryptographic, Redis, store-master, and unrelated provider secrets are absent.

### Acceptance

- A local OpenAI run cannot read an Anthropic key from its harness environment.
- A local harness cannot read Postgres, Agenta cryptographic, or bucket-wide store credentials from the runner process.
- Managed credentials remain per run.
- Daytona infrastructure credentials are blanked from every harness environment.
- Requests missing provider, deployment, or credential mode fail validation rather than inheriting everything.

## Phase 4: declarative bootstraps and subscription cleanup

Goal: replace automatic credential discovery with explicit operator data movement.

### Changes

- Implement and validate bootstrap manifest version 1.
- Add common path, size, file-type, mode, and redaction guards.
- Create per-run local harness config roots.
- Implement local file and directory copy.
- Implement Daytona upload for non-auth bootstrap assets.
- Remove `shouldUploadOwnLogin`, `uploadPiAuthToSandbox`, and their fallback tests.
- Reject Daytona `runtime_provided` authentication with an actionable error.
- Add commented Compose examples for Pi and Claude subscription source mounts.
- Add Helm bootstrap values without shipping any subscription-specific secret by default.

### Acceptance

- No code reads an operator home directory to find credentials.
- Local Pi and Claude subscription runs work only when matching auth assets are declared.
- Missing required bootstrap inputs fail before harness start.
- Harness writes affect only the per-run copy.
- A Daytona run receives declared runtime configuration but never a harness-auth asset.
- Logs and traces do not contain bootstrap content or credential values.

## Phase 5: required mounts fail loudly

Goal: make persistence behavior match the session and artifact contract.

### Changes

- Classify each requested mount as optional ephemeral or required durable.
- Replace nullable best-effort signing results with typed outcomes.
- Fail session runs when cwd signing, store readiness, or mount readiness fails.
- Fail workflow-artifact runs when the agent mount cannot be created.
- Always create required transcript mounts for resumable sessions.
- Remove `AGENTA_SESSION_HARNESS_MOUNTS`.
- Preserve one bounded local geesefs transport-disconnect recovery.
- Emit structured error codes for configuration, signing, reachability, FUSE, and recovery exhaustion.
- Update keepalive so a failed required mount can never produce a pool key or parked environment.

### Acceptance

- A session run cannot return success from an ephemeral directory.
- A sessionless invoke still works without the store.
- An artifact-backed run cannot continue without its agent mount.
- Store and FUSE failures surface a remediation-oriented error.
- Recovery tests prove one remount attempt and then failure.

## Phase 6: public documentation

Goal: publish docs only after names and behavior are stable.

Follow [documentation-plan.md](./documentation-plan.md).

### Acceptance

- Every documented variable appears in the runtime and hosting examples.
- Every runtime variable is either documented or intentionally internal.
- Tutorial commands pass against a clean Compose deployment.
- Daytona guides use managed API keys only.
- The support matrix matches automated QA.
- The docs do not imply local isolation or remote subscription support.

## Proposed PR stack

1. `fix(runner): repair agent snapshot selection and local QA routing`
2. `refactor(runner): introduce typed sandbox provider configuration`
3. `feat(runner): expose enabled sandbox capabilities`
4. `fix(hosting): narrow the runner deployment environment`
5. `feat(runner): add declarative bootstrap assets`
6. `fix(runner): fail required durable mounts loudly`
7. `docs(self-host): explain and configure the agent runner`

The exact stack can combine phases 2 and 3 if they touch the same call path, but bootstrap and mount behavior should remain separate reviews.

## Landing order with open PRs

- PR #5274 is already merged. Phase 0 addresses its immediate follow-ups.
- PR #5285 is docs-only. This design supersedes its allowlist contract but depends on its provider-capability direction for future Docker work.
- PR #5286 can land independently if needed. Preserve its runner token and key narrowing. Remove broad `commonEnv`, the inherit-all flag, and legacy inference in phases 1 and 3.
- The final public docs land last.
