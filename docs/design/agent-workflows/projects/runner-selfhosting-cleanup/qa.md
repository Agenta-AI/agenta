# QA plan

The cleanup is complete only when one deployment can exercise the supported combinations and unsupported combinations fail for the intended reason.

## 1. Primary matrix

| Sandbox | Harness | Authentication | Expected |
|---|---|---|---|
| local | Pi | managed OpenAI or other provider key | pass |
| local | Pi | explicit Pi subscription bootstrap | pass |
| local | Claude | managed Anthropic or supported custom-provider key | pass |
| local | Claude | explicit Claude subscription bootstrap | pass |
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

### Execution-gate tests

- explicit enabled provider passes;
- explicit disabled provider fails before temp directory creation;
- omitted provider uses the configured default;
- no silent fallback occurs;
- keepalive does not create or park an environment for a rejected provider;
- provider factory repeats the hard gate for callers that bypass run-plan construction.

### Capability tests

- `/health` contains process identity only;
- `/capabilities` returns enabled and default providers;
- configured token protects capabilities;
- response contains no credentials or provider URLs;
- Services cache expires and refreshes;
- unavailable runner is not converted into local-only;
- web picker matches the platform response.

## 3. Credential-boundary tests

### Managed credentials

- `credentialMode=env` clears ambient model-provider variables, then applies only resolved secrets;
- Daytona API key is always blank inside the harness;
- local OpenAI run cannot read Anthropic variables;
- local Anthropic run cannot read OpenAI variables;
- Daytona sandbox receives only the selected model credential and scoped operational data.

### Runtime-provided credentials

- provider, deployment, and credential mode are required;
- no `hasApiKey` inference remains;
- no inherit-all environment mode remains;
- local auth requires a matching `purpose: harness-auth` asset;
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

## 4. Bootstrap tests

### Manifest validation

- version must be 1;
- asset ids are unique;
- source type is file or directory;
- source path must be inside a configured bootstrap input root;
- destination path is relative and traversal-free;
- destination root is known;
- provider and harness selectors are non-empty and known;
- file mode cannot be group/world writable;
- required source must exist at startup;
- optional missing source is omitted with one redacted warning;
- symlink, socket, device, excessive count, excessive depth, and excessive size are rejected.

### Local materialization

- every run gets a unique config root;
- Pi receives `PI_CODING_AGENT_DIR` pointing at the copy;
- Claude receives `CLAUDE_CONFIG_DIR` pointing at the copy;
- source is mounted read-only;
- harness writes do not mutate the source;
- teardown removes the per-run copy;
- concurrent runs cannot see each other's bootstrap copies.

### Daytona materialization

- matching runtime-config file and directory assets upload before daemon start;
- mode and destination match local semantics;
- harness-auth assets are rejected before sandbox creation;
- upload failure tears down the partial sandbox;
- content, source paths, and remote credential paths do not appear in logs or traces.

## 5. Harness installation tests

- published local image contains the pinned Pi version;
- published Daytona snapshot contains the pinned Pi version;
- custom Daytona image missing Pi triggers one pinned install;
- successful install continues the run;
- failed install returns the version and executable location without credentials;
- stale `AGENTA_AGENT_SANDBOX_PI_INSTALLED` has no effect because the variable is absent from the contract;
- Claude first-use install follows the existing license-safe path.

## 6. Mount tests

| Case | Expected |
|---|---|
| sessionless run, store unavailable | ephemeral run passes |
| session run, signing unavailable | run fails |
| session run, scoped credentials invalid | run fails |
| session run, store unreachable | run fails |
| session run, geesefs readiness fails | run fails |
| transport endpoint disconnected once | one remount, then continue if healthy |
| transport endpoint disconnected twice | run fails |
| artifact run, agent mount invalid | run fails |
| resumable run, transcript mount unavailable | run fails and does not park |
| successful session turn | file survives a cold next turn |

Each failure assertion checks the structured error code, mount kind, user-action category, redaction, teardown, and zero leaked Daytona sandboxes.

## 7. Local 8280 acceptance

Before deleting the extra runners:

1. Record the currently selected `AGENTA_RUNNER_INTERNAL_URL`.
2. Confirm which service contains the Daytona credential.
3. Confirm which read-only subscription inputs exist.
4. Configure the normal runner with enabled providers `local,daytona`.
5. Add local-only Pi and Claude auth bootstrap assets.
6. Run the primary matrix.
7. Confirm the Daytona sandbox count returns to zero.
8. Stop the legacy subscription sidecars.
9. Repeat one local subscription cell and both Daytona managed-key cells.
10. Record the final Compose service and environment shape.

Personal credentials and generated bootstrap copies must never be committed.

## 8. CI commands

Implementation PRs should run the narrow suites first, then the area suite required by repository instructions:

- runner unit and acceptance tests under `services/runner`;
- Services and SDK agent tests for wire changes;
- API tests for capability proxy or configuration responses;
- web package tests for the picker;
- Helm lint and rendered-template assertions;
- Compose config rendering for OSS/EE and dev/GH variants;
- agent-workflows QA against the supported matrix;
- one replay regression for each real failure worth pinning.
