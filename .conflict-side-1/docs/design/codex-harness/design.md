# Design

This document describes how the Codex harness integrates into the existing
architecture. It builds on `research.md` (the map of the current code) and
`spike/findings.md` (empirical evidence; every load-bearing claim below has a
transcript there). Decisions that need Mahmoud's ruling are marked D-00x and live in
`decisions.md`; everything else is a direct copy of the Claude pattern.

## Shape of the integration

Codex runs exactly where Claude runs: the runner asks the sandbox-agent daemon for a
session with `agent: "codex"`, the daemon spawns the `codex-acp` bridge, and the
bridge spawns `codex app-server`. Events, tool calls, and permission requests arrive
as the same ACP frames the runner already consumes. No daemon changes are needed. The
work is five thin layers:

1. SDK: a `CodexHarness` adapter and a `codex_settings.py` that renders
   `config.toml`.
2. Runner: credential preparation, one environment variable group, a Codex branch in
   the approval-gate classification, and the subscription mount contract.
3. Model catalog: a curated entry (the live models are gpt-5.6-sol, the default,
   gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, and gpt-5.2; the gpt-5.1-codex ids still
   appear in listings but the backend rejects them as deprecated).
4. Sidecar: Codex OAuth login already exists for the Pi path; the harness reuses it.
5. Release gate: a Codex cell.

## Configuration: config.toml is the whole permission surface

Codex reads its configuration from `$CODEX_HOME/config.toml`. The author-facing
permission options are `approval_policy` (untrusted, on-request, on-failure, never)
and `sandbox_mode` (read-only, workspace-write, danger-full-access). Per-MCP-server
and per-tool approval controls exist too: `default_tools_approval_mode` on a server
(auto, prompt, writes, approve) and a per-tool `approval_mode` override, plus
`enabled_tools` and `disabled_tools` lists.

`codex_settings.py` mirrors `claude_settings.py` exactly in structure:

- **Layer 1 (author options, pass-through).** The harness's `permissions` slice
  carries codex-native keys (`approval_policy`, `sandbox_mode`) verbatim into
  `config.toml`. We invent no vocabulary.
- **Layer 2 (sandbox boundary reinforcement).** Filesystem `readonly`/`off` maps to
  `sandbox_mode = "read-only"` unless the author set something stricter. Network
  restrictions map to disabling codex's web tools where config allows.
- **Layer 3 (per-server and per-tool rules).** Each user MCP server's permission maps
  to that server's `default_tools_approval_mode` (allow → approve, ask → prompt,
  deny → the server's tools go into `disabled_tools`). Each resolved executable
  tool's permission maps to a per-tool `approval_mode` under the `agenta-tools`
  server entry. The spike proved the critical case: a server set to `approve` runs
  its tools with zero permission gates even under `approval_policy = "untrusted"`,
  which is the Codex analog of the Claude per-tool allow rule (the F-046 requirement:
  an "allow" tool must run without pausing).

The rendered file rides the existing `harnessFiles` wire seam and the runner's blind
file writer, like Claude's `.claude/settings.json`. Where it lands is decision D-002.

One Codex-specific hazard, registered as D-007: codex 0.145 also reads workspace
config layers (`<cwd>/.codex/config.toml` and bare `<cwd>/config.toml`). The spike
showed these can tighten gating but not loosen it. A user repo containing a stray
`config.toml` therefore silently influences codex behavior.

## Credentials and the home directory (D-002, Checkpoint 1)

Codex accepts three credential forms (all daemon-path proven): an `auth.json`
containing the API key (works with no environment variable at all), an environment
key plus the adapter's `DEFAULT_AUTH_REQUEST` auto-login, and an `auth.json`
containing ChatGPT OAuth tokens. The simplest managed-key setup is pre-seeding
`auth.json`; that is what the runner will do, with the same create-if-absent,
restrictive-mode, delete-only-if-created discipline `pi-assets.ts` uses today.

The open layout question is where `CODEX_HOME` points in each mode; the options and
the recommendation are in D-002. The subscription mode additionally interacts with
per-run config delivery (the mount holds the operator's own `config.toml`), covered
in the same decision. The adapter offers one more delivery channel that may resolve
it cleanly: `CODEX_CONFIG`, a JSON object in the environment merged into every
session's config, proven able to loosen as well as tighten. Whether the runner can
scope that environment variable per run (given daemon session pooling) is marked TO
VERIFY early in Milestone 1.

## Approvals and human-in-the-loop (D-003, D-004)

The bridge raises real ACP `session/request_permission` frames on the same channel
Claude's do, so the park-and-resume architecture applies unchanged. The Codex branch
in `acp-interactions.ts` must handle three verified differences:

1. Exec gates carry no tool name, only `kind: "execute"` plus the raw command; the
   classification keys on that, like Claude's Bash gate.
2. MCP gates arrive with an almost empty `toolCall` (no arguments); identity and
   arguments must be joined from the earlier `tool_call` event by `toolCallId`. The
   frame carries the marker `_meta.is_mcp_tool_approval: true`.
3. Codex names MCP tools `mcp.<server>.<tool>` with dots, not Claude's
   `mcp__<server>__<tool>`; the per-server permission matching needs a mapping.

Option sets differ per gate type, and the daemon SDK maps a reply of "always" to the
session-scoped allow in both cases, never a persistent one. That matches how the
runner treats Claude approvals.

Two defaults need a ruling: the platform default `approval_policy` when the author
sets nothing (D-003), and the default `sandbox_mode` inside our containers (D-004).
The spike found codex's own bubblewrap sandbox fails to initialize in containerized
environments, so codex effectively cannot self-sandbox inside our infrastructure;
the practical posture is the one Claude already takes (the Agenta sandbox is the
boundary), but the interplay of approval policies with a disabled inner sandbox
changes gate frequency and needs one probe in Milestone 3.

## Adapter supply chain (D-005)

The daemon installs the Codex ACP bridge (`@agentclientprotocol/codex-acp`, which
bundles the codex CLI) from the ACP registry at first use with a floating version
range. The Claude bridge is pinned; the Codex one is not, and version drift there
changes protocol behavior under us. D-005 proposes pinning by pre-installing the
adapter at a fixed version (runner bootstrap in development, baked images for
production).

## What is intentionally not designed

- No E2B path (no E2B sandbox exists on main).
- No change to Pi's Codex-models path.
- No handling of codex's cross-session memory features: a per-run `CODEX_HOME` means
  codex's own memory resets each run. If we ever want persistent codex memory, that
  is a separate design on top of session mounts.
- Daytona subscription auth stays rejected, same rule as Claude.
