# Daytona Sandbox Snapshot

This folder contains the supported self-host recipe for building a Daytona snapshot for the
Agenta `sandbox-agent` runner path.

We ship the recipe, not a built snapshot. The operator runs it in their own Daytona account:

```bash
DAYTONA_API_KEY=... DAYTONA_TARGET=eu uv run build_snapshot.py --force
```

Configure the runner service with:

```bash
SANDBOX_AGENT_PROVIDER=daytona
DAYTONA_SNAPSHOT=agenta-sandbox-pi
AGENTA_AGENT_SANDBOX_PI_INSTALLED=false
```

## What is baked

The recipe bases on `rivetdev/sandbox-agent:*-full`. That base image already installs the
Claude, Codex, and OpenCode native binaries and ACP adapters. It also includes the Pi ACP
adapter, but not the standalone `pi` CLI that the adapter launches.

The snapshot recipe therefore:

- installs `@earendil-works/pi-coding-agent@0.80.6`;
- fails the build unless `pi --version` succeeds;
- verifies that the Claude, Codex, and OpenCode binaries are still present; and
- installs the FUSE and geesefs dependencies used for durable remote working directories.

## Pi installation controls

The runner keeps the reliable bare-image behavior by default:

- unset or `AGENTA_AGENT_SANDBOX_PI_INSTALLED=true`: install the pinned Pi version into
  each new sandbox session and point `pi-acp` at it;
- `AGENTA_AGENT_SANDBOX_PI_INSTALLED=false`: skip the session-time install because the
  configured snapshot already contains Pi; and
- `AGENTA_AGENT_SANDBOX_PI_VERSION`: override the pinned session-time fallback version.

Despite its historical `_INSTALLED` name, the boolean controls whether the runner performs
the session-time installation. Set it to `false` only together with a snapshot known to
contain Pi, such as `agenta-sandbox-pi`.

The full base image includes Claude Code. We do not distribute the resulting snapshot. Agenta
Cloud builds its own internal snapshot, and self-hosters build their own.

Keep credentials out of the image and snapshot. Provider keys and self-managed login paths are
runtime concerns.
