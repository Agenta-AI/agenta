# Hosting

Deployment configuration for self-hosting Agenta. Each surface below deploys the same
services: the web studio, the API, the workflow services, the agent runner, Postgres, Redis,
and a durable object store.

## Docker Compose

`docker-compose/` holds one folder per edition, `oss/` and `ee/`. Within each edition the
Compose files split by build mode:

| File | Edition | Mode | Use |
|---|---|---|---|
| `docker-compose/oss/docker-compose.dev.yml` | OSS | dev | Local development with source bind-mounts and hot reload. |
| `docker-compose/oss/docker-compose.gh.yml` | OSS | gh | Self-host from published images. |
| `docker-compose/oss/docker-compose.gh.local.yml` | OSS | gh | Self-host from locally built images. |
| `docker-compose/oss/docker-compose.gh.ssl.yml` | OSS | gh | The gh stack with SSL termination. |
| `docker-compose/oss/docker-compose.otel.yml` | OSS | gh | Optional OpenTelemetry collector overlay. |
| `docker-compose/ee/docker-compose.dev.yml` | EE | dev | Enterprise local development. |
| `docker-compose/ee/docker-compose.gh.yml` | EE | gh | Enterprise self-host from published images. |
| `docker-compose/ee/docker-compose.gh.local.yml` | EE | gh | Enterprise self-host from locally built images. |

Each edition folder ships an `env.<edition>.<mode>.example` file. Copy it to a real env file
and edit it before starting the stack. `docker-compose/run.sh` selects the files for an
edition and mode (`--oss`/`--ee`, `--dev`/`--gh`).

## Kubernetes (Helm)

`kubernetes/helm/` is the Helm chart. `values.yaml` is the default configuration and
`values.schema.json` validates overrides. `kubernetes/oss/` and `kubernetes/ee/` hold
edition-specific values. See
[Deploy on Kubernetes](https://docs.agenta.ai/self-host/guides/deploy-to-kubernetes).

## Railway

`railway/oss/` deploys the OSS stack to Railway, one folder per service. `railway/oss/scripts/`
builds and pushes the images. See
[Deploy on Railway](https://docs.agenta.ai/self-host/guides/deploy-on-railway).

## Runner images

Agent runs use two separate images. Do not confuse them.

- **Runner service image** (`services/runner/images/service/`) runs the runner process itself.
  `Dockerfile.gh` is the production image and `Dockerfile.dev` is the hot-reload development
  image. The Compose and Railway builds reference these files.
- **Sandbox image** (`services/runner/images/sandbox/<provider>/`) is the environment an agent
  runs inside. For Daytona, `services/runner/images/sandbox/daytona/build_snapshot.py` is the
  snapshot build recipe. Agenta ships the recipe, not a prebuilt snapshot: run it against your
  own Daytona account to build a snapshot named `agenta-agent-sandbox-v1`, then point the runner at it
  with `AGENTA_RUNNER_DAYTONA_SNAPSHOT`. For local runs, the runner service image is also the
  sandbox.

To add binaries or dependencies to agent runs, see
[Customize the agent runtime](https://docs.agenta.ai/self-host/agent-execution/customize-the-agent-runtime).
