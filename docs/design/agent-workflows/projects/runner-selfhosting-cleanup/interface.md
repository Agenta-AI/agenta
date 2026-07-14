# Target interfaces

This document classifies every field by semantic role and ownership. Names follow what a value is, not the feature that first needed it.

## 1. Deployment topology

A normal installation has one logical runner service. It may have multiple replicas later, but every replica in one runner deployment uses the same provider configuration.

Services locates the runner. The runner owns sandbox execution. The code evaluator is a separate consumer with separate provider configuration.

~~~text
Services
  AGENTA_RUNNER_INTERNAL_URL
  AGENTA_RUNNER_TOKEN
        |
        v
Agent runner
  enabled sandbox providers
  default sandbox provider
  local provider
  Daytona provider credentials and lifecycle
        |
        +--> local daemon and harness
        |
        +--> Daytona sandbox, daemon, and harness

Code evaluator
  separate code-execution provider configuration
~~~

## 2. Canonical environment variables

### Caller-to-runner routing

| Variable | Role | Owner and reader | Sensitive | Change cadence |
|---|---|---|---:|---|
| `AGENTA_RUNNER_INTERNAL_URL` | routing locator | deployment operator; Services reads it | no | deployment |
| `AGENTA_RUNNER_TOKEN` | protocol credential | deployment operator; Services sends it and runner verifies it | yes | deployment or rotation |

The shared token is the same protocol credential at both ends, so one name is correct. It does not belong to a sandbox or harness.

### Runner process

| Variable | Role | Default | Sensitive |
|---|---|---|---:|
| `AGENTA_RUNNER_HOST` | server binding | `127.0.0.1`; hosting sets a private interface | no |
| `AGENTA_RUNNER_PORT` | server binding | `8765` | no |
| `AGENTA_RUNNER_CONCURRENCY_LIMIT` | capacity configuration | current safe default | no |
| `AGENTA_RUNNER_LOG_LEVEL` | logging configuration | current default | no |
| `AGENTA_RUNNER_REPLICA_ID` | replica identity | generated when absent | no |
| `AGENTA_API_INTERNAL_URL` | callback routing locator | deployment-specific | no |

`AGENTA_API_INTERNAL_URL` keeps its standard name because it identifies the API, not the runner. The runner does not receive a static `AGENTA_API_KEY`. Session coordination, mount signing, and trace export use the caller credential already carried on each run request. Removing the static exporter fallback prevents a local harness from stealing a reusable platform credential through /proc.

### Sandbox provider registry

| Variable | Role | Default |
|---|---|---|
| `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` | deployment capability configuration | `local` |
| `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER` | routing default | `local` |

Rules:

1. Values are normalized lowercase provider ids separated by commas.
2. Unset enabled providers means exactly `local`.
3. An explicitly empty list is invalid.
4. Unknown and duplicate ids are invalid.
5. The default must be enabled.
6. A request may select any enabled provider.
7. A request for a known but disabled provider fails before mounts, files, secrets, or sandboxes are created.
8. There is no fallback from an unavailable requested provider to another provider.
9. Adding a provider to a future runner release never enables it in an existing deployment.

This is capability configuration, not a user authorization list. Per-project entitlement or policy can restrict the deployment set later, but cannot expand it.

The API reads the same two variables. Hosting templates set both services from one operator-facing entry in the env file, so the operator configures the value once. See section 4.

### Deployment postures

The enabled-provider list is also the security posture switch:

- **Trusted self-host (default):** `local` only. Local harnesses share the runner container; that is documented as a convenience for a single trusted operator, not an isolation boundary. Subscription mounts are an opt-in for this posture.
- **Multi-tenant or exposed:** `daytona` only. No harness process ever runs inside the runner container, so user code cannot read the runner's process environment or its Daytona provisioning credential. Setting the list is the entire posture change.

### Runner-owned Daytona configuration

| Variable | Role | Required when Daytona is enabled | Sensitive |
|---|---|---:|---:|
| `AGENTA_RUNNER_DAYTONA_API_KEY` | infrastructure credential | yes, unless an explicit supported token pair is configured later | yes |
| `AGENTA_RUNNER_DAYTONA_API_URL` | external service locator | no | no |
| `AGENTA_RUNNER_DAYTONA_TARGET` | region or target routing | no | no |
| `AGENTA_RUNNER_DAYTONA_SNAPSHOT` | runtime artifact reference | no, runner uses its pinned default | no |
| `AGENTA_RUNNER_DAYTONA_IMAGE` | runtime artifact override | no | no |
| `AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES` | sandbox lifecycle configuration | no | no |
| `AGENTA_RUNNER_DAYTONA_AUTODELETE_MINUTES` | sandbox lifecycle configuration | no | no |
| `AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS` | warm-session policy | no | no |
| `AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM` | warm-pool capacity | no | no |

Snapshot and image are mutually exclusive. Invalid positive durations fail startup. Empty strings are treated as absent only at the hosting parser boundary, then the typed runner config contains either a value or no value.

The runner constructs a Daytona client explicitly from this object. It does not rely on the Daytona SDK reading ambient `DAYTONA_*` values.

### Removed variables

The cleanup deletes these names and their tests, examples, Helm values, and docs:

- `SANDBOX_AGENT_PROVIDER`
- `SANDBOX_AGENT_LOG_LEVEL` (becomes `AGENTA_RUNNER_LOG_LEVEL`)
- `DAYTONA_API_KEY`
- `DAYTONA_API_URL`
- `DAYTONA_TARGET`
- `DAYTONA_SNAPSHOT`
- `DAYTONA_SNAPSHOT_AGENT`
- `DAYTONA_IMAGE`
- `DAYTONA_AUTOSTOP`
- `DAYTONA_AUTODELETE`
- `AGENTA_AGENT_SANDBOX_DAYTONA_SNAPSHOT`
- `AGENTA_AGENT_SANDBOX_PI_INSTALLED`
- `AGENTA_SESSION_HARNESS_MOUNTS`
- `AGENTA_SANDBOX_LOCAL_ALLOWED`
- `AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS`

There are no aliases. Code-evaluator Daytona values get a separate namespace in its own follow-up rather than continuing to use the removed shared names.

## 3. Startup validation and readiness

The runner parses configuration once before listening.

It fails startup when:

- the enabled-provider list is empty or invalid;
- the default is not enabled;
- Daytona is enabled without a provisioning credential;
- snapshot and image are both set;
- lifecycle values are invalid;
- the runner token is required by hosting but missing on one side.

Startup logs one redacted resolved configuration summary:

~~~text
runner providers enabled=[local,daytona] default=local
runner daytona target=eu artifact=snapshot:agenta-agent-runner-v3
~~~

No credential value or local source path is logged.

## 4. Provider availability for API and web

Version 1 uses one shared value instead of a discovery endpoint.

The API already gates sandbox availability from its own environment today (`AGENTA_SANDBOX_LOCAL_ALLOWED` in `api/oss/src/utils/env.py`). The cleanup renames that existing gate rather than adding a new mechanism:

- The API reads `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` and `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER` with the same parsing rules as the runner.
- Compose, Helm, and Railway set both services from one operator-facing entry, so the operator configures the value once and drift requires deliberate effort.
- The web filters the sandbox picker from the API's existing configuration surface.
- The runner remains the final authority. A request for a disabled provider fails before side effects with an explicit "provider not enabled on this deployment" error, so even a drifted API produces an honest failure instead of a wrong run.
- `/health` remains a cheap unauthenticated process-health check.

A runner `GET /capabilities` endpoint is deferred to [open issue RSH-7](./open-issues.md). It becomes worthwhile when deployments have multiple heterogeneous runners, not before.

## 5. Run protocol authentication

`credentialMode` is required and has three values:

| Value | Meaning | Credential source |
|---|---|---|
| `env` | Agenta resolved a managed credential | per-run secret map |
| `runtime_provided` | the harness authenticates from explicitly prepared runtime state | local subscription mount |
| `none` | the run intentionally has no model credential | no credential |

The target contract requires the provider and deployment metadata used for model-key narrowing; missing or unknown values fail validation, and the legacy "infer from hasApiKey" branch does not exist. Because the flip breaks any caller that omits the fields, it lands only after the caller audit in [plan.md phase 2](./plan.md) confirms every in-repo run path already sends them. The `AGENTA_RUNNER_INHERIT_ALL_PROVIDER_KEYS` escape hatch is deleted regardless.

For `runtime_provided`:

- local Pi and local Claude read explicitly mounted subscription state (section 6);
- Daytona Pi and Daytona Claude return a specific unsupported-combination error in version 1;
- the runner never searches its own home directory.

## 6. Local subscription mounts and runtime customization

Version 1 has no bootstrap manifest, no `AGENTA_RUNNER_BOOTSTRAP_CONFIG`, and no validation engine. The operator moves files the same way they customize every other service they run: through the Compose file and images they own.

The two problems this replaces the manifest for:

1. The runner must stop discovering its own Pi login and uploading it to Daytona. `shouldUploadOwnLogin` and `uploadPiAuthToSandbox` are deleted with their tests.
2. A local operator needs a declared way to use their own Pi, Claude, or Codex subscription.

### Local subscription mounts

The operator mounts credential state read-write into the runner container and points the harness config variable at it. The Compose files ship commented examples:

~~~yaml
runner:
  # Opt-in: use your own harness subscription for local runs.
  # volumes:
  #   - ~/.pi:/agenta/harness/pi:rw
  # environment:
  #   - PI_CODING_AGENT_DIR=/agenta/harness/pi
~~~

Rules:

- Mounts are read-write, and the harness runs directly out of the mount. There is no per-run copy of the credential state.

  A subscription login is an OAuth login: the harness refreshes its access token mid-run and writes the new one back to its own config directory. A read-only mount plus a per-run copy discarded that refresh, so as soon as the provider rotated the refresh token the next run failed and the operator had to log in again by hand. Letting the harness own its token lifecycle, exactly as it does on a normal local install, is the only shape that survives rotation.

  The tradeoff: harness writes land in the operator's login directory (refreshed tokens, and any skills or system prompt a run installs), and concurrent local subscription runs share that directory the same way two local harness sessions do. This path is single-trusted-operator only, so both are acceptable.
- A `runtime_provided` local run without the matching mount fails with an error naming the missing configuration.
- Mounted subscription state never leaves the runner container. Daytona runs never receive it.
- One personal subscription belongs to one operator. The docs state this is a single-tenant convenience.

### Runtime customization

Extra binaries, certificates, and system dependencies are image concerns, not run-time file copies:

- Local: build a custom runner image from `services/runner/docker/Dockerfile.gh` (documented how-to).
- Daytona: build and upload a custom snapshot with the existing scripts in `services/runner/sandbox-images/daytona/`, then set `AGENTA_RUNNER_DAYTONA_SNAPSHOT` (documented how-to).
- Extra project folders for local runs: an operator-owned Compose volume mount (documented how-to).

A declarative bootstrap-asset manifest, hooks, plugins, and VPN setup remain future work ([RSH-4](./open-issues.md)) and start from real operator demand.

## 7. Harness installation

Harness availability is an image/runtime contract, not operator truth.

- Pi uses a runner-pinned version.
- The runner probes the expected Pi executable.
- If a Daytona custom image or snapshot lacks Pi, the runner installs the pinned version before the session and logs the repair.
- If installation fails, the run fails with the missing executable and attempted version.
- The published runner image and published Daytona snapshot include Pi to avoid the repair path.
- Claude installation follows its existing licensing-safe first-use path and is also probed.

There is no "installed" environment flag.

## 8. Mount contract

The run identity determines what persistence the run is supposed to have:

| Run shape | Expected storage |
|---|---|
| no session id, no workflow artifact | ephemeral cwd is valid |
| session id present | session cwd mount |
| workflow artifact present | agent mount |
| resumable harness session | harness transcript mounts |

Version 1 keeps the current best-effort behavior. Changing mount failure semantics is a behavior rewrite, not configuration cleanup, and it stays out of the release. Version 1 changes only two things:

1. When a durable mount degrades to an ephemeral directory, the runner emits one structured warning naming the mount kind and the cause, so degradation frequency becomes measurable instead of silent.
2. `AGENTA_SESSION_HARNESS_MOUNTS` is removed as a public switch; transcript mounts derive from the session contract.

The fail-loud contract (a required mount failure fails the run, no silent durable-to-ephemeral downgrade) is deferred to [RSH-11](./open-issues.md) and should be informed by the warning-log data.

## 9. Hosting shape

### Docker Compose

The runner service enumerates only runner variables. It has no shared `env_file`. The examples include commented, opt-in read-write volumes for subscription inputs (section 6).

One runner service can enable `local,daytona`; there is no second subscription runner in the default stack.

### Helm

Target values:

~~~yaml
agentRunner:
  enabled: true
  providers:
    enabled: [local]
    default: local
    daytona:
      apiKeySecretRef:
        name: agenta-runner-daytona
        key: api-key
      apiUrl: https://app.daytona.io/api
      target: eu
      snapshot: agenta-agent-runner
      autostopMinutes: 15
      autodeleteMinutes: 30
  auth:
    tokenSecretRef:
      name: agenta-runner
      key: token
~~~

The runner deployment must not include `agenta.commonEnv`. A dedicated helper renders only its narrow environment and provider secret references. Callback authorization arrives per run rather than through a pod-wide API key.

### Railway

Railway uses the same canonical environment names and one runner service. Unsupported local volume-based subscription setup is documented honestly rather than approximated with hidden copies.
