# The four decisions

Make these before you run anything. Each one fixes flags and env vars you cannot change
later without a redeploy.

## 1. Edition: OSS or EE

- **OSS** (`--oss`): the open-source stack. Web studio, API, workflow services, agent
  runner, Postgres, Redis, object store.
- **EE** (`--ee`): adds access control, SSO, and multi-org. EE DB name is
  `agenta_ee_core`; OSS is `agenta_oss_core`.

The edition selects the Compose folder (`hosting/docker-compose/oss/` or `.../ee/`) and the
env-file family (`.env.oss.*` or `.env.ee.*`). `run.sh` derives both from `--oss` / `--ee`.

## 2. Image source: gh, gh --local, or dev

Three ways to get the container images. This decides whether you run released code, your
branch, or a hot-reload dev loop.

| You want | Flags | Stage | Images |
|---|---|---|---|
| Run the released product | `--gh` | `gh` | Pulled from `ghcr.io/agenta-ai/*` |
| Run your own working tree (a feature branch) | `--gh --local --build` | `gh.local` | Built from your checkout |
| Hot-reload dev with source bind-mounts | `--dev` | `dev` | Built locally, code mounted |

- `--gh` pulls prebuilt images by default (`--no-pull` to skip). Use it for a normal
  self-host.
- `--local` requires `--gh` and switches to the `gh.local` Compose file, which builds the
  images from your local source instead of pulling. Add `--build` to force the build (and
  `--no-cache` for a clean build). This is how you self-host an unreleased branch.
- `--dev` bind-mounts source and hot-reloads. It is a development loop, not a deployment.

## 3. Exposure: plain port, domain + TLS, or tunnel

How the outside world reaches the stack. This sets your URL env vars and decides whether
you must harden (resources/harden.md).

- **Plain `IP:port`** — Traefik publishes on port 80 by default (`TRAEFIK_PORT` to change).
  Set the URL env vars to your host. A public IP means you MUST harden.
- **Domain + TLS** — terminate TLS with the `--ssl` stage (OSS) or a proxy in front. See
  https://docs.agenta.ai/self-host/guides/using-ssl and
  https://docs.agenta.ai/self-host/guides/deploy-remotely .
- **Cloudflare / other tunnel** — a proxy in front of Traefik. This is the case that
  produces `http://` redirects unless you set the forwarded-header vars. See
  troubleshoot.md entry 2.

## 4. Who can start runs: local vs Daytona sandbox

This is a safety decision, not a convenience one.

- A **local run** executes inside the runner container. It is not isolated from other runs:
  one user's agent can read another user's files and the mounted credentials.
- A **Daytona sandbox** run executes in a per-run cloud sandbox, isolated from the host and
  from other runs.

Rule: if more than one person can start runs on the deployment, enable Daytona. Local runs
are for a single trusted operator. Full model:
https://docs.agenta.ai/self-host/agent-execution/sandbox-isolation-and-security .

Enabling each provider:
- Local: https://docs.agenta.ai/self-host/agent-execution/run-agents-locally
- Daytona: https://docs.agenta.ai/self-host/agent-execution/daytona
</content>
