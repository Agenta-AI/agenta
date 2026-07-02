# E2B Sandbox Template

Baked E2B template for the Agenta sandbox-agent runner. Contains the rivet daemon
(`sandbox-agent`) and four harnesses — Pi, Codex, OpenCode, and Claude — pre-installed so a
cold E2B sandbox never pays a runtime `install-agent` fetch. E2B sandboxes are ephemeral (never
reused across runs), so this is the dominant remote cold-start cost every one of these harnesses
would otherwise pay on EVERY run.

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
- **Pi**: `pi-acp` ACP adapter (MIT) + `@earendil-works/pi-coding-agent` CLI (MIT), versions
  pinned to `services/runner/package.json`
- **Codex**: `@zed-industries/codex-acp` ACP adapter (npm) + the native `codex` CLI (Rust,
  GitHub release binary)
- **OpenCode**: the native `opencode` binary (GitHub release; speaks ACP natively, no separate
  adapter package)
- **Claude**: `@zed-industries/claude-agent-acp` ACP adapter (npm) + the native `claude` CLI,
  fetched directly from Anthropic's own release bucket (never a third-party mirror — see the
  licensing note in `services/runner/sandbox-images/daytona/build_snapshot.py` for why that
  boundary matters)
- Node 22 (the E2B base ships Node 20; `pi-acp` requires >=22.19)

Every harness is laid out at the exact path `sandbox-agent install-agent <id>` would have used
(`~/.local/share/sandbox-agent/bin/agent_processes/<id>`), replicated by hand because
`install-agent` hangs inside the E2B builder. Credentials are never baked; they are injected at
runtime.

### Why baking still helps even without a daemon-side skip flag

Unlike Pi (which the daemon never auto-installs — the runner alone decides whether to install
it, gated by `AGENTA_AGENT_SANDBOX_PI_INSTALLED`), Codex and Claude are installed
UNCONDITIONALLY by the `sandbox-agent/e2b` provider's `create()` on every sandbox
(`DEFAULT_AGENTS = ["claude", "codex"]` in the daemon's compiled binary), and there is no env
var or `SandboxProvider` hook that lets the runner skip that call. OpenCode is not even in that
list, so it is never daemon-auto-installed at all today.

So `AGENTA_AGENT_SANDBOX_{CODEX,OPENCODE,CLAUDE}_INSTALLED` (mirroring
`AGENTA_AGENT_SANDBOX_PI_INSTALLED`'s naming) do NOT gate any runner-side install call the way
Pi's flag does — there is none to gate for these three. They are carried into the sandbox env
for visibility only (see `e2b.ts`/`provider.ts`). The bake still pays off because the daemon's
own agent installer checks for an existing install before doing any work
(`agent_manager.install_agent_process: already installed`, observed in the compiled daemon
binary) — baking turns the daemon's `install-agent` call into a fast no-op instead of a fresh
npm/binary fetch. If a future `sandbox-agent` release adds a real daemon-side skip mechanism for
these three, wire it through these same env vars.

## E2B_TIMEOUT_MS is an idle backstop, not a run budget

`E2B_TIMEOUT_MS` (default 30 minutes, see `DEFAULT_E2B_TIMEOUT_MS` in `provider.ts`) is a leak
backstop: it exists to self-reap a sandbox whose owning runner process was killed (`docker stop`
/ SIGKILL / OOM) before its `finally` could call `destroySandbox`. E2B enforces it as an
absolute deadline from sandbox creation, which would otherwise kill a legitimately long-running
turn mid-flight — unlike Daytona's `autoStopInterval`, which measures IDLE time and never fires
on a busy sandbox.

The runner closes that gap with an idle-refresh keepalive
(`src/engines/sandbox_agent/e2b-keepalive.ts`): once a run's E2B sandbox exists, the runner
calls `Sandbox.setTimeout(sandboxId, E2B_TIMEOUT_MS)` (a static method on
`@e2b/code-interpreter`, a direct dependency of `services/runner` — reachable independently of
the `sandbox-agent` wrapper, whose own `SandboxProvider` interface exposes no extend-timeout
affordance) on an interval of `E2B_TIMEOUT_MS / 3`. So in practice:

- A live run keeps pushing its deadline forward — `E2B_TIMEOUT_MS` is a rolling idle window
  ("time since last liveness proof"), exactly Daytona's semantics, not a cap on total run time.
- A killed runner simply stops refreshing, and the sandbox self-reaps within `E2B_TIMEOUT_MS` of
  the kill — the original leak-backstop guarantee is unchanged.

`E2B_TIMEOUT_MS` remains the one knob for both meanings (idle window length AND leak-backstop
bound); there is no separate "run budget" setting.
