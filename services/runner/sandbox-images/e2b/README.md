# E2B Sandbox Template

Baked E2B template for the Agenta sandbox-agent runner. Contains the rivet daemon
(`sandbox-agent`) and the Pi harness (`@earendil-works/pi-coding-agent` + `pi-acp`
adapter). Pi is baked in; opencode and Claude are auto-installed at runtime by the daemon.

## Build

```bash
npx @e2b/cli template create agenta-sandbox-agent -d e2b.Dockerfile
```

The template name `agenta-sandbox-agent` is the default the runner reads from
`E2B_TEMPLATE`. Rebuild after changing `e2b.Dockerfile` or pinned package versions.

## Configure the runner

```bash
SANDBOX_AGENT_PROVIDER=e2b
E2B_API_KEY=...
E2B_TEMPLATE=agenta-sandbox-agent
```

For opencode, also supply the provider key in the run request `secrets`:

```bash
# Anthropic-backed opencode
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI-backed opencode
OPENAI_API_KEY=sk-...
```

`E2B_TEMPLATE` defaults to `agenta-sandbox-agent`; omit it if you kept the default name.

## What is baked in

- `sandbox-agent` daemon binary (rivet, Apache-2.0)
- `pi-acp` ACP adapter (MIT) at the version pinned in `services/agent/package.json`
- `@earendil-works/pi-coding-agent` CLI (MIT) at the same pinned version
- Node 22 (the E2B base ships Node 20; `pi-acp` requires >=22.19)

Claude Code and opencode are NOT baked — they are installed from their upstreams at
runtime by the daemon (`install-agent claude` / `install-agent opencode`). Credentials
are injected at runtime via `envs`, never baked.

## Arch note (opencode)

E2B runs on real x86-64 cloud hardware. The daemon's `install-agent opencode` fetches the
linux-x64 Bun binary, which is correct on E2B. No arch override is needed. The SIGTRAP
gotcha (`rosetta error … ld-linux-x86-64.so.2`) only affects local arm64 dev machines.

## Scope

Pi (baked) + Claude + opencode (both auto-installed). The Daytona equivalent is
`services/agent/sandbox-images/daytona/build_snapshot.py`.
