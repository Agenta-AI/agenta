# QA plan

The cleanup is complete only when one deployment can exercise the supported combinations and unsupported combinations fail for the intended reason.

## 1. Primary matrix

| Sandbox | Harness | Authentication | Expected |
|---|---|---|---|
| local | Pi | managed OpenAI or other provider key | pass |
| local | Pi | explicit Pi subscription mount | pass |
| local | Claude | managed Anthropic or supported custom-provider key | pass |
| local | Claude | explicit Claude subscription mount | pass |
| Daytona | Pi | managed provider key | pass |
| Daytona | Claude | managed provider key | pass |
| Daytona | Pi | runtime-provided subscription | reject before sandbox creation |
| Daytona | Claude | runtime-provided subscription | reject before sandbox creation |

Run the passing cells with:

- a stateless prompt;
- one tool call;
- a session follow-up;
- a file written to the session cwd and read on the next turn;
- a workflow artifact that exposes the agent mount.

## 2. Provider configuration tests

### Parser unit tests

- enabled providers unset gives `local`;
- explicit `local,daytona` preserves order-independent set equality;
- leading and trailing whitespace normalize;
- duplicate ids fail;
- unknown ids fail;
- explicit empty string fails;
- default unset gives local;
- default outside the enabled set fails;
- Daytona enabled without provisioning credentials fails;
- Daytona absent ignores optional Daytona tuning;
- snapshot plus image fails;
- invalid zero, negative, non-numeric, and fractional lifecycle values fail;
- Compose-substituted empty optional values become absent.

The API-side parser (`AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` read by the API) gets the same parser unit cases so both readers agree on every input.

### Execution-gate tests

- explicit enabled provider passes;
- explicit disabled provider fails before temp directory creation with the explicit "provider not enabled on this deployment" error;
- omitted provider uses the configured default;
- no silent fallback occurs;
- keepalive does not create or park an environment for a rejected provider;
- provider factory repeats the hard gate for callers that bypass run-plan construction;
- the web picker shows exactly the configured enabled set (API-derived);
- a deliberately drifted API value still ends in the runner's honest rejection, not a wrong run.

## 3. Credential-boundary tests

### Managed credentials

- `credentialMode=env` clears ambient model-provider variables, then applies only resolved secrets;
- Daytona API key is always blank inside the harness;
- local OpenAI run cannot read Anthropic variables;
- local Anthropic run cannot read OpenAI variables;
- Daytona sandbox receives only the selected model credential and scoped operational data.

### Runtime-provided credentials

- caller audit outcome is enforced: if the strictness flip landed, provider, deployment, and credential mode are required and no `hasApiKey` inference remains; if it was deferred, the audit record in status.md names the omitting caller and the follow-up;
- no inherit-all environment mode remains;
- local runtime-provided auth requires the matching subscription mount and fails with an error naming the missing configuration when absent;
- Daytona runtime auth fails with a stable unsupported-combination code;
- no function scans `HOME`, `PI_CODING_AGENT_DIR`, or `CLAUDE_CONFIG_DIR` for implicit upload;
- no Pi `auth.json` is written to a Daytona sandbox during managed runs.

### Rendered deployment assertions

Render OSS and EE Helm charts and inspect the runner container environment. Assert the absence of:

- `POSTGRES_PASSWORD`;
- `POSTGRES_URI_*`;
- `AGENTA_AUTH_KEY`;
- `AGENTA_CRYPT_KEY`;
- `AGENTA_API_KEY`;
- Redis passwords and URIs;
- bucket-wide `AGENTA_STORE_ACCESS_KEY` and `AGENTA_STORE_SECRET_KEY`;
- unrelated LLM provider credentials;
- `agenta.commonEnv` expansion.

Assert the presence of only configured runner values, runner token reference, API locator, and provider-specific secret references. Callback and trace tests assert that the per-run caller credential is used and never promoted to process-wide state.

## 4. Subscription mount tests

- every runtime-provided run runs directly out of the operator's mount (no per-run config copy);
- Pi receives `PI_CODING_AGENT_DIR` pointing at the mount;
- Claude receives `CLAUDE_CONFIG_DIR` pointing at the mount;
- the operator source is mounted read-write and a token the harness refreshes persists to it;
- teardown does NOT delete the mount;
- concurrent local subscription runs share the mount (accepted: single trusted operator);
- subscription state never uploads to a Daytona sandbox;
- content and credential paths do not appear in logs or traces.

## 5. Harness installation tests

- published local image contains the pinned Pi version;
- published Daytona snapshot contains the pinned Pi version;
- custom Daytona image missing Pi triggers one pinned install;
- successful install continues the run;
- failed install returns the version and executable location without credentials;
- stale `AGENTA_AGENT_SANDBOX_PI_INSTALLED` has no effect because the variable is absent from the contract;
- Claude first-use install follows the existing license-safe path.

## 6. Mount tests

Version 1 keeps best-effort behavior, so QA asserts observability instead of hard failure:

| Case | Expected |
|---|---|
| sessionless run, store unavailable | ephemeral run passes, no warning |
| session run, durable mount degrades to ephemeral | run continues and one structured warning names mount kind and cause |
| transport endpoint disconnected once | one remount, then continue if healthy |
| successful session turn | file survives a cold next turn |
| `AGENTA_SESSION_HARNESS_MOUNTS` set in the environment | no effect; variable absent from the contract |

The fail-loud cases (session, artifact, and transcript mount failures failing the run) move to RSH-11 with this table as their starting point.

## 7. Local 8280 acceptance

Before deleting the extra runners:

1. Record the currently selected `AGENTA_RUNNER_INTERNAL_URL`.
2. Confirm which service contains the Daytona credential.
3. Confirm which read-write subscription inputs exist.
4. Configure the normal runner with enabled providers `local,daytona`.
5. Add local-only Pi and Claude read-write subscription mounts.
6. Run the primary matrix.
7. Confirm the Daytona sandbox count returns to zero.
8. Stop the legacy subscription sidecars.
9. Repeat one local subscription cell and both Daytona managed-key cells.
10. Record the final Compose service and environment shape.

Personal credentials and generated per-run copies must never be committed.

## 8. CI commands

Implementation PRs should run the narrow suites first, then the area suite required by repository instructions:

- runner unit and acceptance tests under `services/runner`;
- Services and SDK agent tests for wire changes;
- API tests for the provider-availability configuration;
- web package tests for the picker;
- Helm lint and rendered-template assertions;
- Compose config rendering for OSS/EE and dev/GH variants;
- agent-workflows QA against the supported matrix;
- one replay regression for each real failure worth pinning.
