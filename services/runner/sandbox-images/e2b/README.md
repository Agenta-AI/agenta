# E2B Sandbox Template

Baked E2B template for the Agenta sandbox-agent runner. Contains the rivet daemon
(`sandbox-agent`) and the Pi harness (`@earendil-works/pi-coding-agent` + `pi-acp`
adapter). Pi is baked in; no runtime install is needed.

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

`E2B_TEMPLATE` defaults to `agenta-sandbox-agent`; omit it if you kept the default name.

## What is baked in

- `sandbox-agent` daemon binary (rivet, Apache-2.0)
- `pi-acp` ACP adapter (MIT) at the version pinned in `services/runner/package.json`
- `@earendil-works/pi-coding-agent` CLI (MIT) at the same pinned version
- Node 22 (the E2B base ships Node 20; `pi-acp` requires >=22.19)

Claude Code is NOT baked — it is installed from Anthropic at runtime by the daemon
(`install-agent claude`). Credentials are injected at runtime, never baked.

## Scope

Pi harness only. Claude / Codex / opencode on E2B are deferred (need the non-Pi remote
bootstrap generalization). The Daytona equivalent is
`services/runner/sandbox-images/daytona/build_snapshot.py`.
