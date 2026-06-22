# Agent runner images

Images for the agent runner (the `sandbox-agent server` runtime in
`services/agent/src/server.ts`). The Python service calls it in-network at
`:8765`.

- `Dockerfile.dev` — dev image. `tsx watch`, source bind-mounted, hot reload.
- `Dockerfile` — production image. Source baked in, no watcher.

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
