# Research (verified facts)

Source-verified June 2026 against a clone of `rivet-dev/sandbox-agent` (Rust daemon plus
TypeScript SDK), the ACP spec and adapters, the Pi and Claude Code docs, and the Agenta
codebase. Rivet file paths below are inside the rivet repo. Agenta paths are in this repo.

## Rivet, in one paragraph

`sandbox-agent` is a daemon that runs **inside** a sandbox and drives coding harnesses
over ACP. Where it runs (local, Docker, E2B, Daytona, Vercel, Cloudflare) is decided by
the **TypeScript SDK** providers, not the Rust core. License: Apache-2.0. We adopt it as a
dependency and do not fork it for this WP.

## Licensing (verified, safe to adopt commercially)

Confirmed against the actual LICENSE files and package manifests June 2026.

- **rivet-dev/sandbox-agent is Apache-2.0 throughout** (root LICENSE, Rust crates, TS SDK).
  OSI-open, no BSL/SSPL/Elastic/non-commercial clause. Compatible with Agenta's MIT OSS
  core and the commercial EE.
- **The server binary is open and self-buildable** (`cargo run -p sandbox-agent
  --release`, ~15MB static binary). The `curl | sh` installer pulls a prebuilt from Rivet's
  CDN (`releases.rivet.dev`), the same source compiled, with no key/auth/telemetry. Build
  from source if you want zero external dependency.
- **No phone-home.** No Rivet account, API key to rivet.dev, or license server. Runs
  offline and air-gapped. `$SANDBOX_TOKEN` is local auth, disable with `--no-token`.
  Session persistence is pluggable (Postgres / in-memory; Rivet Actors optional).
- **Everything we ship or link is permissive:** pi-acp (MIT), claude-code-acp
  /`@zed-industries/claude-agent-acp` (Apache-2.0), Daytona SDK (Apache-2.0), E2B (MIT),
  Pi / Codex / opencode (MIT or Apache-2.0). No GPL/AGPL/SSPL/BSL in the bundled path.
- **Two restrictive pieces, both user-brought (weak coupling):** Claude Code is
  proprietary (Anthropic Commercial ToS); the user installs it and brings their own
  Anthropic auth, and we only shell out to it over ACP. Never bundle, auto-download, or
  repackage it. Daytona's *server* is AGPL-3.0, but its client SDK is Apache-2.0 and the
  AGPL binds whoever operates/modifies the server, not an API consumer; Agenta already
  depends on the Daytona SDK for code evaluators.

## The SDK shape (what the TypeScript runner calls)

Approximate API (verify exact names against the installed SDK version from rivet.dev):

- `SandboxAgent.start({ sandbox: local() })` or `{ sandbox: daytona({...}), env: {...} }`
  brings up a daemon and returns a handle. The `local` provider spawns
  `sandbox-agent server` as a host subprocess; the SDK merges `{...process.env,
  ...options.env}` into that process. The `daytona` provider creates a Daytona sandbox and
  starts the daemon inside it.
- `createSession({ agent, cwd })` opens an ACP session and returns a `serverId`. `agent`
  is the harness id.
- `prompt(sessionId, text)` sends the turn; the daemon streams events (SSE), assistant
  text arrives as `agent_message_chunk`. Accumulate the chunks into the final string.
- `destroy()` / `pauseSandbox()` tear down. On the Daytona provider, both delete the
  sandbox (it implements only create/destroy; no stop/pause is wired).

Harness ids (`AgentId` enum in `server/packages/agent-management/src/agents.rs`):
`Claude, Codex, Opencode, Amp, Pi, Cursor`. **Pi is first-class.**

## One daemon hosts many sessions

The core is `AcpProxyRuntime` with `instances: HashMap<server_id, ProxyInstance>`
(`server/packages/sandbox-agent/src/acp_proxy_runtime.rs`). Each session spawns its own
ACP adapter subprocess with its own `cwd`. We do **not** rely on this multiplexing for the
MVP; we run one daemon and one session per invoke (see the lifecycle decision below).

## Harnesses are ACP adapters, resolved from a registry

Each harness maps to an ACP adapter program. Rivet builds a `LaunchSpec {program, args,
env}` from a registry (`acp-http-adapter/src/registry.rs`); the canonical registry is the
ACP one, with a pinned audit list in `scripts/audit-acp-deps/adapters.json` (e.g.
`pi-acp@0.0.23`, `@zed-industries/claude-agent-acp@0.20.0`). The adapters are small
TypeScript npm packages:

- **pi-acp** (svkozak/pi-acp, MIT, TypeScript): spawns `pi --mode rpc`, passes its env
  through to `pi`. Pi auto-loads extensions from `~/.pi/agent/extensions` and global
  settings.
- **claude-code-acp** (`@zed-industries/claude-agent-acp`, Apache-2.0, TypeScript): wraps
  the Claude Agent SDK.

To use a forked adapter, point the launch command at it (npm package, local path, or your
own registry json). The adapter runs wherever the daemon runs. We do **not** need a fork
for this WP (see tracing).

## Environment injection (how trace context and secrets reach the harness)

`AdapterRuntime::start` (`acp-http-adapter/src/process.rs`) inherits the **daemon's env**
and overlays the static registry `LaunchSpec.env`. There is **no per-session env channel**
from the create-session HTTP path. Consequence:

- A value set in the daemon's env is inherited by the adapter and the harness.
- Because we run **one daemon per invoke**, the daemon's env is per-invoke. So we set the
  `traceparent`, OTLP config, and secrets in the daemon's env at its birth: the SDK `env`
  option locally, the sandbox `env_vars` on Daytona. This is exactly how `DaytonaRunner`
  already injects `AGENTA_*` and provider keys for code evaluators.
- The per-session-env gap only bites if you later share one warm daemon across concurrent
  invokes. Then you would carry the traceparent in ACP `_meta` (a spec-blessed reserved
  key, RFD completed 2026-06-03) plus a small adapter read, or patch rivet. Not now.

## ACP facts

- ACP is Zed's **Agent Client Protocol** (editor to coding-agent), JSON-RPC. Flow:
  `initialize`, then `session/new` or `session/load`, then `session/prompt`, with streamed
  `session/update` notifications. Not IBM's Agent Communication Protocol, not Google A2A.
- `session/load` replays the conversation via `session/update`, an optional capability
  advertised in `initialize`. Pi exposes `resumeSession`; Claude Code `loadSession` (with
  limits reconstructing old tool calls). This backs message-history continuation without
  any persisted filesystem.

## The pattern we mirror: code evaluators in Daytona

Verified in the Agenta SDK. `DaytonaRunner`
(`sdks/python/agenta/sdk/engines/running/runners/daytona.py`) runs each code evaluator in
**one ephemeral Daytona sandbox per execution**: it creates an `ephemeral=True` sandbox
from a snapshot (`DAYTONA_SNAPSHOT`), runs, and deletes it in a `finally`. No warm pool, no
shared instance. It injects `AGENTA_HOST`, `AGENTA_API_KEY`, and provider keys as the
sandbox `env_vars`. Concurrency is bounded by the evaluation engine's shared
`asyncio.Semaphore(batch_size)` (default 10), not by the runner. Selected by env
`AGENTA_SERVICES_CODE_SANDBOX_RUNNER=daytona`. The agent service copies this shape.

## Sessions and Daytona cost

Daytona bills compute while a sandbox runs, storage while stopped, cheapest when archived.
An idle-but-running sandbox keeps billing. Rivet's Daytona provider only does
create/destroy, so "keep it warm and resume" is both unbuilt and costly. With no
persistent file writes there is nothing on disk to keep. So a session is stored message
history plus an ephemeral sandbox per turn (~1s Daytona cold start per the WP-3 POC, plus
history replay). Tradeoff: replaying long histories re-sends tokens, so cap with
truncation or summarization.

## Tracing per harness

- **Pi:** reuse the existing `agenta-otel` logic, but install it as a Pi extension in the
  environment (global `~/.pi/agent/extensions`, or baked into the Daytona snapshot). Feed
  `AGENTA_*` / `OTEL_*` / `traceparent` as env. pi-acp passes env through to `pi`, Pi loads
  the extension, and spans nest under the parent.
- **Claude Code:** OTel is first-party. Set `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_*`
  (endpoint and `Authorization` header for Agenta's OTLP), and `TRACEPARENT`, and run it in
  `-p` / Agent-SDK mode (interactive mode ignores inbound traceparent). A known beta bug
  may drop some spans in streaming ACP mode; verify before relying on it.
- The dominant way people instrument Claude Code is this built-in OTel exporter into a
  collector or platform. Our wiring uses the same channel.

## Filesystem: no jail exists

Grep for `chroot|landlock|bubblewrap|seccomp|namespace|unshare|jail` across rivet's
`server/` returns zero hits. `cwd` is advisory; the file HTTP API (`resolve_fs_path`)
returns absolute paths verbatim. An agent can read and write anywhere the daemon can. This
only matters when many agents share one daemon, which the per-invoke model avoids.
Confinement is deferred to [`isolation-and-fork.md`](isolation-and-fork.md).
