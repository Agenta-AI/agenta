# OpenCode on Daytona — investigation

## Goal

Make `harness="opencode"` run on the **Daytona** sandbox (remote). The opencode-local work
(`chore/add-harness-opencode`) is the base — `OpencodeHarness`, `HarnessType.OPENCODE`,
`OpencodeAgentTemplate`, the `opencode→opencode` ACP agent map, and the `planMode:false`
static fallback all exist. This worktree adds the remote-sandbox axis.

## How Pi-on-Daytona works (the pattern to clone)

`services/agent/src/engines/sandbox_agent/daytona.ts` has two responsibilities:

1. **`daytonaEnvVars(piExtEnv, secrets)`** — builds the env injected into the Daytona daemon at
   sandbox-create time. It spreads `piExtEnv` (Pi extension vars: traceparent, OTLP, relay dir)
   and `secrets` (provider API keys). This is called by `buildDaytonaCreate` in `provider.ts`,
   which passes it to `daytona({ create: … })`. The env is **harness-agnostic**: the `secrets`
   spread already puts `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` into the daemon env for every
   harness, not just Pi.

2. **`prepareDaytonaPiAssets({ sandbox, plan })`** — runs after the sandbox starts and
   BEFORE `createSession`. It uploads the Pi auth fallback, the Agenta extension bundle,
   skill dirs, and system prompts into the sandbox via the filesystem API, then optionally
   installs the Pi CLI (`npm install @earendil-works/pi-coding-agent`). It **early-returns on
   `!plan.isPi`**, so any non-Pi harness skips it entirely today.

For opencode the relevant question is: what does `prepareDaytonaPiAssets` do that opencode
needs on Daytona? Answer: nothing. The daemon auto-installs opencode from a GitHub release
binary zip at `createSession` time (the same auto-install that runs on local). The provider
key is already in the daemon env from `daytonaEnvVars`. No auth file, no extension bundle,
no skill dir upload is needed.

## The credential story (plain managed provider key)

opencode accepts both provider families (anthropic + openai) with `provider/model`-prefixed
ids. Zen is a third-party hosted gateway; the daemon's Zen layer is experimental/disabled.
The credential is simply a plain provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) in
the sandbox env. The `secrets` spread in `daytonaEnvVars` already delivers it. No new
`KNOWN_PROVIDER_ENV_VARS` entry, no auth file, no new clear-set variable.

## The arch gotcha

The daemon's `install_opencode` (`agent_manager.install_opencode` / `install_zip_binary`)
fetches the GitHub release zip for the CURRENT system arch at install time. On a **dev host
that is arm64 and a Daytona sandbox image that is also arm64**, this is correct and works.
On a **dev host that is x64 and a Daytona sandbox image that is arm64** (uncommon but possible
with cross-arch Daytona targets), the binary would be wrong.

The PoC documented a `SIGTRAP` (`rosetta error … ld-linux-x86-64.so.2`) when the daemon
on an arm64 sandbox installed the linux-x64 binary. The fix in the PoC was: after the
failed install, overwrite `bin/opencode` and `bin/agent_processes/opencode/opencode` with
the correct-arch release from `anomalyco/opencode`.

**Runner disposition**: the runner cannot know the sandbox image's arch at create time
without a sandbox probe. The correct fix is at the **sandbox image / snapshot** level: bake
a snapshot with the correct-arch opencode binary pre-installed, or set an env override that
tells the daemon which arch to fetch. The runner exports an override env var
`AGENTA_AGENT_SANDBOX_OPENCODE_ARCH` that — when set — forces the in-sandbox arch string the
daemon uses, e.g. `linux-arm64`. `daytonaEnvVars` injects it only when `acpAgent === "opencode"`
(see `daytona.ts` `opencodeArchEnv`). On real x64 cloud Daytona, the arch matches and no
override is needed. On a dev machine with an arm64 Daytona target, set
`AGENTA_AGENT_SANDBOX_OPENCODE_ARCH=linux-arm64`.

## Why the runner code change is minimal

`sandbox_agent.ts` already calls `prepareDaytonaPiAssets({ sandbox, plan })` inside the
`if (plan.isDaytona)` block. For non-Pi harnesses that block was a no-op (Pi guard returns
early). The change: rename the call site to also call a new
`prepareDaytonaOpencodeAssets({ sandbox, plan })` for the opencode case. For opencode,
this function injects the arch override env and is otherwise a no-op. The Pi path is
unchanged.

## Foundation seam

A "foundation" worktree (`chore/add-foundation-remote-bootstrap`) is generalizing the
non-Pi remote bootstrap. The current code structure has two seams:

1. `prepareDaytonaPiAssets` handles Pi-specific uploads.
2. The new `prepareDaytonaOpencodeAssets` handles the opencode case (arch override only).

When the foundation lands, these fold onto a single `prepareDaytonaHarnessAssets(sandbox,
plan)` dispatcher that routes on `plan.acpAgent`. The interface is already there.

## planMode: false

Preserved. `capabilities.ts` static fallback already sets `planMode: false` for opencode,
and the daemon skips `session/set_mode` for it. Nothing changes on Daytona.

## anomalyco/opencode is OFFICIAL

`anomalyco/opencode` is OpenCode's official repository (anomaly.co is the company behind
OpenCode). It is never a fork. The binary zip the daemon fetches comes from this official
release.

## Files to touch

- `services/agent/src/engines/sandbox_agent/daytona.ts` — add `opencodeArchEnv()` and
  `prepareDaytonaOpencodeAssets(...)`; gate arch override in `daytonaEnvVars` on `acpAgent`.
- `services/agent/src/engines/sandbox_agent.ts` — call the new function in the
  `if (plan.isDaytona)` block.
- `services/agent/tests/unit/sandbox-agent-daytona.test.ts` — tests for the new function
  and the arch override.
- `docs/design/agent-workflows/projects/add-opencode-daytona/` — this research, specs,
  tasks.
