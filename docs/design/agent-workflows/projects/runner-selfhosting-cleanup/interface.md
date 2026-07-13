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
| `AGENTA_RUNNER_REPLICA_ID` | replica identity | generated when absent | no |
| `AGENTA_API_INTERNAL_URL` | callback routing locator | deployment-specific | no |
| `AGENTA_RUNNER_BOOTSTRAP_CONFIG` | locator for a mounted bootstrap manifest | absent | no |

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
- the bootstrap manifest is invalid or a required source is missing;
- the runner token is required by hosting but missing on one side.

Startup logs one redacted resolved configuration summary:

~~~text
runner providers enabled=[local,daytona] default=local
runner daytona target=eu artifact=snapshot:agenta-agent-runner-v3
runner bootstrap assets=2 local=2 daytona=0
~~~

No credential value, bootstrap content, or local source path is logged.

## 4. Provider capability discovery

The runner is authoritative. API and web do not parse the same environment variable independently.

Add an authenticated internal endpoint:

~~~http
GET /capabilities
Authorization: Bearer <AGENTA_RUNNER_TOKEN>
~~~

Response:

~~~json
{
  "protocol": 1,
  "sandboxProviders": {
    "default": "local",
    "enabled": ["local", "daytona"]
  },
  "harnesses": ["pi", "claude"]
}
~~~

Rules:

- `/health` remains a cheap unauthenticated process-health check and does not claim provider readiness.
- `/capabilities` uses the runner token when configured and contains no secrets.
- Services fetches and caches capabilities with a short TTL, rejects disabled providers early, and exposes the result through an authenticated platform endpoint.
- The web filters the sandbox picker from the platform response.
- The runner still enforces the provider at run time. Discovery is for honest UX, not the security boundary.
- An unreachable runner produces "runner unavailable," not an invented local-only capability set.

## 5. Run protocol authentication

`credentialMode` is required and has three values:

| Value | Meaning | Credential source |
|---|---|---|
| `env` | Agenta resolved a managed credential | per-run secret map |
| `runtime_provided` | the harness authenticates from explicitly prepared runtime state | local bootstrap asset |
| `none` | the run intentionally has no model credential | no credential |

Provider and deployment metadata required for model-key narrowing are also required. Missing or unknown values fail contract validation. There is no legacy "infer from hasApiKey" branch and no inherit-all escape hatch.

For `runtime_provided`:

- local Pi and local Claude require a matching bootstrap asset with `purpose: harness-auth`;
- Daytona Pi and Daytona Claude return a specific unsupported-combination error in version 1;
- the runner never searches its own home directory.

## 6. Bootstrap manifest

Bootstrap assets describe files or directories the operator intentionally makes available to a run. The manifest is mounted read-only and selected through `AGENTA_RUNNER_BOOTSTRAP_CONFIG`.

Example:

~~~yaml
version: 1
assets:
  - id: pi-subscription
    purpose: harness-auth
    when:
      sandboxProviders: [local]
      harnesses: [pi]
    source:
      type: file
      path: /run/agenta/bootstrap/pi/auth.json
    destination:
      root: harness-config
      path: auth.json
    mode: "0600"
    required: true

  - id: company-ca
    purpose: runtime-config
    when:
      sandboxProviders: [local, daytona]
      harnesses: [pi, claude]
    source:
      type: file
      path: /run/agenta/bootstrap/certs/company-ca.pem
    destination:
      root: runtime-config
      path: certs/company-ca.pem
    mode: "0644"
    required: true
~~~

### Field semantics

| Field | Role | Rules |
|---|---|---|
| `id` | stable asset identity | unique, log-safe |
| `purpose` | semantic intent | `harness-auth` or `runtime-config` in version 1 |
| `when.sandboxProviders` | applicability | non-empty subset of enabled providers |
| `when.harnesses` | applicability | non-empty subset of supported harnesses |
| `source.type` | source data shape | `file` or `directory` |
| `source.path` | mounted input locator | absolute path under an allowlisted bootstrap input root |
| `destination.root` | logical target | `harness-config` or `runtime-config` |
| `destination.path` | target data path | relative, normalized, no traversal |
| `mode` | file policy | octal string, cannot grant group or world write |
| `required` | failure policy | required source or copy failure aborts before harness start |

### Materialization

- The local adapter creates a unique per-run harness configuration root, copies applicable assets, sets `PI_CODING_AGENT_DIR` or `CLAUDE_CONFIG_DIR`, and deletes the copy at teardown.
- The Daytona adapter uploads applicable non-auth assets before daemon start and applies the same logical destination mapping.
- Version 1 rejects `purpose: harness-auth` for Daytona.
- Sources are read-only inputs. Harness changes never write back to the operator's source credential.
- Symlinks, devices, sockets, path traversal, excessive file counts, and excessive total size are rejected.
- Asset content and credential filenames are redacted from traces and normal logs.
- Version 1 does not execute scripts. Hooks, plugins, and VPN setup remain future work.

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

The run identity determines persistence:

| Run shape | Required storage |
|---|---|
| no session id, no workflow artifact | ephemeral cwd is valid |
| session id present | session cwd mount |
| workflow artifact present | agent mount |
| resumable harness session | required harness transcript mounts |

For required storage:

1. signing failure fails the run;
2. missing store configuration fails the run;
3. unreachable store fails the run;
4. geesefs mount or readiness failure fails the run;
5. transport-disconnected recovery gets one bounded remount attempt, then fails;
6. no plain directory is substituted at the durable path.

Errors name the failed mount kind and remediation category without exposing credentials. There is no public environment switch to disable transcript mounts.

## 9. Hosting shape

### Docker Compose

The runner service enumerates only runner variables. It has no shared `env_file`. The examples include commented, opt-in read-only volumes for subscription inputs and a commented bootstrap manifest path.

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
  bootstrap:
    configMapRef:
      name: agenta-runner-bootstrap
      key: bootstrap.yaml
    inputVolumes: []
~~~

The runner deployment must not include `agenta.commonEnv`. A dedicated helper renders only its narrow environment and provider secret references. Callback authorization arrives per run rather than through a pod-wide API key.

### Railway

Railway uses the same canonical environment names and one runner service. Unsupported local volume-based subscription setup is documented honestly rather than approximated with hidden copies.
