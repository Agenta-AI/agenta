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

The recipe currently bases on the upstream full sandbox-agent image and adds the Pi CLI.
That image includes Claude Code. We do not distribute the resulting snapshot. Cloud builds its
own internal snapshot; self-hosters build their own.

Keep credentials out of the image and snapshot. Provider keys and self-managed login paths are
runtime concerns.
