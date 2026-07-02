# OpenCode on Daytona — specs

## Scope

In: `harness="opencode"` on the `sandbox="daytona"` sandbox. Out: any changes to the wire
contract, the Python SDK, the local sandbox path, or the Pi-on-Daytona path.

## Behavior

- A `/run` request with `harness="opencode"` and `sandbox="daytona"` provisions a Daytona
  sandbox that carries the managed provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
  in the daemon env. The daemon auto-installs opencode from the official `anomalyco/opencode`
  GitHub release binary zip at `createSession` time; no extra provisioning by the runner.
- `planMode` stays **false** on Daytona (unchanged from local; the daemon skips
  `session/set_mode` for opencode regardless of sandbox).
- The arch override env var `AGENTA_AGENT_SANDBOX_OPENCODE_ARCH` — when set in the runner's
  environment — is injected into the Daytona daemon env so the daemon fetches the correct-arch
  opencode binary. On real x64 cloud Daytona this is a no-op (default arch matches). On a dev
  machine targeting an arm64 Daytona snapshot, set `AGENTA_AGENT_SANDBOX_OPENCODE_ARCH=linux-arm64`.
- The cookie fetch (`createCookieFetch`) is used on Daytona for all harnesses (unchanged).
- Pi-on-Daytona is entirely unchanged.

## Contracts

- Wire unchanged; the `harness` field is a free string.
- No new Python SDK changes; `OpencodeAgentTemplate.wire()` already sets
  `sandbox="daytona"` as a string, and the runner reads it.
- No new Python harness or capability changes; `HARNESS_CONNECTION_CAPABILITIES["opencode"]`
  is already complete.

## Decisions — LOCKED

1. **No auth file upload for opencode.** The credential is a plain managed provider key in
   the daemon env. No `~/.opencode/auth.json` or equivalent. The `credentialMode="env"` path
   never uploads a fallback file.
2. **The arch override is a runner env var, not a per-request wire field.** It is a deploy
   concern (which Daytona snapshot is in use), not a per-run API concern.
3. **anomalyco/opencode is the official OpenCode, never a fork.** The daemon fetches from
   there. We never fork, copy, or re-host opencode.
4. **No new `KNOWN_PROVIDER_ENV_VARS` entry.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are
   already in the clear set.

## Non-goals / invariants

- Pi-on-Daytona: unchanged.
- `daytonaEnvVars` gains an `acpAgent` parameter; the arch override is gated on
  `acpAgent === "opencode"` inline. No separate helper function.
- Local sandbox path for opencode: unchanged.
- No codex, claude, or other harness on Daytona is in scope.

## Acceptance

- Unit (no live daemon):
  - `prepareDaytonaOpencodeAssets` calls nothing on the sandbox (opencode needs no uploads).
  - When `AGENTA_AGENT_SANDBOX_OPENCODE_ARCH` is set and `acpAgent === "opencode"`,
    `daytonaEnvVars` injects it; when unset or for any other harness, it is absent.
  - `prepareDaytonaPiAssets` is not called for an opencode plan (`isPi=false`).
  - `planMode` is false in the static fallback for `opencode` (already tested in capabilities
    tests; no new test needed).
- Integration (requires a live Daytona daemon with the sandbox-agent daemon binary and a
  Daytona API key; marked `@requires-live-daemon`):
  - An opencode-on-Daytona run returns output and a trace with `harness="opencode"`.
  - Only the resolved provider key is present in the sandbox; no Zen or auth-file artefact.
