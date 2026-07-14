---
name: self-host-agenta
description: Router and field guide for self-hosting Agenta with Docker Compose. Use when a user or agent wants to stand up, expose, harden, or debug a self-hosted Agenta deployment (OSS or EE), or asks "how do I self-host Agenta", "run.sh flags", "my self-host redirects to http", "the runner can't be found", "supertokens won't start". Routes to the public self-host docs as the source of truth and adds the operational knowledge (decision tree, gotchas, hardening, troubleshooting, verification) that the docs do not carry.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
user-invocable: true
---

# Self-host Agenta

A thin router to the public self-host docs, plus the field knowledge that does not live
there. The docs at **https://docs.agenta.ai/self-host** are the source of truth for every
procedure. This skill points you at the right page, and carries the decisions, gotchas,
hardening steps, failure modes, and smoke tests an operator needs on top of them.

Do not paste doc content into answers. Link the slug, then add the operational detail from
the resource files below.

## Start here: the four decisions

Every later command follows from four choices. Make them first. Full detail with the exact
flags is in [resources/decisions.md](resources/decisions.md).

1. **Edition** — OSS (`--oss`) or EE (`--ee`). EE adds access control, SSO, orgs.
2. **Image source** — published images from released main (`--gh`), images built from your
   working tree (`--gh --local --build`, for a feature branch), or hot-reload dev
   (`--dev`). Pick `--gh` unless you are running unreleased code.
3. **Exposure** — plain `IP:port`, a domain with TLS, or a Cloudflare/other tunnel. This
   decides your URL env vars and whether you harden (see resources/harden.md).
4. **Who can start runs** — if more than one person can reach the deployment, agents must
   run in Daytona sandboxes, not locally in the runner container. See the isolation doc.

## Routing table: "I want to X" -> doc

| Goal | Page |
|---|---|
| First local deploy (port 80 or custom port) | https://docs.agenta.ai/self-host/quick-start |
| Where to start / what applies to me | https://docs.agenta.ai/self-host/overview |
| Every environment variable and what it does | https://docs.agenta.ai/self-host/configuration |
| Network topology, ports, container DNS | https://docs.agenta.ai/self-host/infrastructure/networking |
| How the services fit together | https://docs.agenta.ai/self-host/infrastructure/architecture |
| Deploy on a remote server | https://docs.agenta.ai/self-host/guides/deploy-remotely |
| Put it behind a domain with TLS | https://docs.agenta.ai/self-host/guides/using-ssl |
| Deploy on Kubernetes (Helm) | https://docs.agenta.ai/self-host/guides/deploy-to-kubernetes |
| Deploy on Railway | https://docs.agenta.ai/self-host/guides/deploy-on-railway |
| Understand how a run reaches the runner | https://docs.agenta.ai/self-host/agent-execution/how-agents-run |
| Run agents with my own Claude/ChatGPT/Pi login | https://docs.agenta.ai/self-host/use-your-own-subscription |
| Run agents in a cloud sandbox (Daytona) | https://docs.agenta.ai/self-host/agent-execution/daytona |
| Run agents locally in the runner container | https://docs.agenta.ai/self-host/agent-execution/run-agents-locally |
| Add binaries, deps, folders, or CPU to agent runs | https://docs.agenta.ai/self-host/agent-execution/customize-the-agent-runtime |
| Which sandbox provider is safe for my deployment | https://docs.agenta.ai/self-host/agent-execution/sandbox-isolation-and-security |
| Every runner environment variable | https://docs.agenta.ai/self-host/agent-execution/runner-configuration |

## Operational resources (the part not in the docs)

Open the file that matches the phase you are in.

- [resources/decisions.md](resources/decisions.md) — the four decisions above, expanded
  into the exact `run.sh` flags and env vars each one sets.
- [resources/operate.md](resources/operate.md) — `run.sh` flags, env-file resolution,
  running multiple isolated instances, building a non-released branch, and when a URL
  change needs a container recreate vs an image rebuild.
- [resources/harden.md](resources/harden.md) — public-IP hardening: loopback-bind
  Postgres and the Traefik dashboard, change the default DB creds, generate real
  `AGENTA_AUTH_KEY` / `AGENTA_CRYPT_KEY`.
- [resources/troubleshoot.md](resources/troubleshoot.md) — field-verified failures keyed
  to the exact error text: runner CLI not found, `http://` redirects behind a proxy,
  subscription login not read, docker.sock permission, empty supertokens URI.
- [resources/verify.md](resources/verify.md) — the smoke tests that prove a deployment is
  healthy: API health, runner health, the runner startup log, a Daytona sandbox count,
  loopback-bound ports.

## Ground rules

- The docs are the source of truth. If a resource file and a doc disagree, the doc wins and
  the resource file is stale. Fix it.
- Verify every command before you hand it to an operator. These run against a real
  deployment. The commands here were checked against the Compose files in `hosting/`.
- Run commands from the repo root. `run.sh` resolves paths relative to it.
</content>
</invoke>
