# Agent runner images

Images for the agent runner (the `sandbox-agent server` runtime in
`services/agent/src/server.ts`). The Python service calls it in-network at
`:8765`.

- `Dockerfile.dev` — dev image. `tsx watch`, source bind-mounted, hot reload.
- `Dockerfile` — production image. Source baked in, no watcher.
- `Dockerfile.sidecar` — **all-harness, self-host sidecar recipe.** Builds on the
  production image and bakes the Pi provisioning the dev compose CMD does inline today,
  so a single `docker run` (no compose CMD override) hosts every harness — `pi_core`,
  `pi_agenta`, and `claude`. Optionally bakes Claude Code from Anthropic for fast cold
  starts. See [The all-harness self-host sidecar](#the-all-harness-self-host-sidecar)
  below. `sidecar-entrypoint.sh` is its entrypoint.

## Licensing posture (read before changing any image or build recipe)

The rule that shapes every image here:

> **We ship build recipes, not Claude-containing images, and we never bake a
> credential into any image.**

Why:

- **Pi** (`@earendil-works/pi-coding-agent`) is MIT. We bake it freely via the npm
  dependencies, in every image and snapshot.
- **Claude Code** is proprietary (© Anthropic PBC, governed by Anthropic's
  [Commercial Terms](https://www.anthropic.com/legal/commercial-terms);
  [legal & compliance](https://code.claude.com/docs/en/legal-and-compliance)). The
  Commercial Terms grant a usage license only. They do not grant any right to
  redistribute, resell, sublicense, or repackage the Services. So an image **we
  build and distribute must not contain Claude Code.**
- Claude Code is installed **from Anthropic** (`npm install -g
  @anthropic-ai/claude-code`, `https://claude.ai/install.sh`, or the daemon's
  `install-agent claude`). That keeps Anthropic as the distributor, which is the
  permitted path. The production sidecar does this at runtime; a snapshot we build
  for our own use does it at build time.

## Authentication

Auth is injected at runtime, never baked into a layer.

- **API key (default, and the only option for cloud / multi-tenant).** Set
  `ANTHROPIC_API_KEY` (or pass provider keys as request secrets from the vault).
  Anthropic directs products and services that interact with Claude to use API key
  auth, so this is the path for any Agenta-orchestrated run that serves users.
- **OAuth subscription (self-host opt-in only).** An individual operator may mount
  their own Claude login (e.g. `~/.claude`) into the container and run with their
  own subscription. This is for personal, individual use of Claude Code, never for
  serving other users, and it is the operator's responsibility. Anthropic restricts
  Free/Pro/Max OAuth to first-party use and forbids third parties routing requests
  through it (enforced since 2026-03). Cloud and multi-tenant deployments must stay
  API-key only.

We never bake an OAuth login or an API key into an image.

## Build recipes (two paths)

- **Cloud / Daytona (API key).** The Daytona snapshot recipe bakes Pi. Agenta Cloud
  builds and uses its own snapshot internally; self-hosters run the same recipe
  against their own Daytona account. We ship the build script (the recipe), not the
  built snapshot, so we never distribute a Claude-containing artifact. Snapshot
  builder: `services/agent/sandbox-images/daytona/build_snapshot.py`.
  Self-hosters run this recipe in their own Daytona account. That is
  compliant under the recipe-not-image model. **Cleaner-provenance follow-up
  (needs a live Daytona build to verify):** base on a daemon-only sandbox-agent image and
  install Claude from Anthropic at build, so the snapshot's Claude comes straight
  from Anthropic rather than from a third party's bundled image. Relocation of the
  builder into this folder is a follow-up.
- **Self-host (API key, OAuth optional).** Build the production `Dockerfile` (it
  bakes neither Claude nor a credential), then supply auth at runtime: an
  `ANTHROPIC_API_KEY` env var, or, for individual use, a mounted OAuth login dir.

## The all-harness self-host sidecar

`Dockerfile.sidecar` is the **self-host shape**: one image that serves every harness
(`pi_core`, `pi_agenta`, `claude`) on `:8765` with no compose CMD override. It exists
because the production `Dockerfile` is the Pi-capable runner but relies on an external
orchestrator to make Pi usable. The dev compose service overrides the image CMD to run as
root, `mkdir -p /pi-agent`, copy the Pi login, and rebuild the extension before serving. A
self-hoster running a bare `docker run` of that image as a non-root user instead hits
`EACCES: mkdir '/pi-agent/extensions'`, because the runner daemon tries to lay the Agenta
Pi extension into an unwritable `PI_CODING_AGENT_DIR`. (That is exactly why
`agenta-claude-sub-sidecar` — the same image with a plain entrypoint, non-root, no Pi prep
— can host `claude` but not Pi.)

`Dockerfile.sidecar` bakes that provisioning in:

- creates `/pi-agent` at build owned by the runtime user (`node`), so a non-root run can
  write it — no compose CMD, no `EACCES`. `PI_CODING_AGENT_DIR=/pi-agent` is set;
- `sidecar-entrypoint.sh` ensures the dir and, if `~/.pi/agent` is mounted read-only at
  `/pi-agent-ro`, copies it in (the same Pi-login seed the compose CMD does);
- the Agenta Pi extension bundle is already in `dist/` from the runner image's
  `pnpm run build:extension`, so there is no runtime rebuild;
- sets a writable `HOME=/home/node` and serves on `0.0.0.0:8765`.

### Licensing boundary (same rule as above)

This is a build **recipe**, not an image Agenta publishes. With the default
`INSTALL_CLAUDE_CODE=true` it installs Claude Code **from Anthropic** at build, so the
self-hoster who runs `docker build` is the one pulling it for their own individual use.
**The resulting image must not be published, pushed to a shared registry, or distributed by
Agenta** — that would make Agenta a Claude Code redistributor, which the Commercial Terms
forbid. Build with `--build-arg INSTALL_CLAUDE_CODE=false` for a redistribution-safe base
that bakes no Claude Code and installs it from Anthropic at runtime instead (Pi works either
way). No credential is ever baked.

### Build (reuses the production build, two steps)

```bash
# 1. Production runner image (Pi baked, extension bundled):
docker build -t agenta-sandbox-agent:latest \
  -f services/agent/docker/Dockerfile services/agent

# 2. All-harness sidecar on top of it:
docker build -t agenta-allharness-sidecar:latest \
  -f services/agent/docker/Dockerfile.sidecar services/agent
```

Reuse an already-built runner image with `--build-arg RUNNER_IMAGE=<image>` instead of
rebuilding step 1.

### Run

```bash
# Subscription OAuth (individual self-host use only): mount the host Claude login read-only.
docker run -d --name agenta-allharness-sidecar \
  -p 127.0.0.1:8790:8765 \
  -v "$HOME/.claude":/home/node/.claude:ro \
  agenta-allharness-sidecar:latest

# Or API-key auth (the cloud / multi-tenant safe path):
docker run -d --name agenta-allharness-sidecar \
  -p 127.0.0.1:8790:8765 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  agenta-allharness-sidecar:latest
```

Bind the host port to `127.0.0.1`: `/run` bodies can carry resolved secrets, so the runner
must never be exposed off-host. Subscription OAuth is individual-use only and must never
serve other users; cloud / multi-tenant deployments must stay API-key only. The runtime
user is `node` (uid 1000), so on a host whose uid is not 1000 the read-only `~/.claude`
mount may be unreadable — either run on a uid-1000 host or mount a writable copy of
`~/.claude`. Daytona is **not** used here — this sidecar is local-only by design (Claude
Code's IP is banned on Daytona).

The manual, no-rebuild version of this (mount the existing runner image's source and run as
the host user) is documented in
`docs/design/agent-workflows/projects/subscription-sidecar/README.md`; this Dockerfile is
its productized, single-`docker run` form.
