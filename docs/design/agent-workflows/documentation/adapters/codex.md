# The Codex adapter

Codex is the third harness. It confirms the seam established by Claude Code: adding a new
MCP-capable harness is one config value plus a thin adapter layer. Where Claude is locked to
the Anthropic provider, Codex is locked to OpenAI.

Read the [architecture](../architecture.md) and [ports and adapters](../ports-and-adapters.md)
pages first. The [Claude Code adapter](claude-code.md) is the closest sibling — the Codex
adapter mirrors it in nearly every respect.

## Running Codex

The daemon resolves the harness id `codex` to the codex ACP adapter. The daemon auto-installs
the codex CLI and its `@zed-industries/codex-acp` bridge on the first `createSession({ agent:
"codex" })` call (locked, idempotent). No bootstrap step is required for the local sandbox;
the first run triggers the install and subsequent runs reuse the cached binary.

Codex runs in `agent-full-access` mode.

## Credential handling

Codex reads `~/.codex/auth.json` as a **file** in addition to the `OPENAI_API_KEY` environment
variable. Environment injection alone is insufficient — the file must be written.

Two credential modes are supported:

- **Managed (`credentialMode="env"`)**: Agenta injects the credential value from the project
  vault. `prepareLocalCodexAssets` writes `~/.codex/auth.json = {"OPENAI_API_KEY": "<key>"}`
  before the daemon starts. The source key is `OPENAI_API_KEY` (preferred) or `CODEX_API_KEY`
  (fallback); the auth.json field is always `OPENAI_API_KEY` — that is what the codex CLI reads.
  Only the resolved key reaches the daemon environment; no other provider key leaks
  (clear-then-apply, Security rule 5).

- **Self-managed (`credentialMode="runtime_provided"`)**: The user's own `~/.codex/auth.json`
  is already present on the host. The daemon inherits the sidecar's HOME and reads it directly;
  `prepareLocalCodexAssets` verifies the file exists and logs a warning when it does not.

`CODEX_API_KEY` appears in `KNOWN_PROVIDER_ENV_VARS` as a defensive clear-set entry (so no
inherited key leaks on managed runs). It is never written to auth.json — only used as a fallback
source when `OPENAI_API_KEY` is absent in the managed path.

## Tools over MCP

Codex reports the `mcpTools` capability (or falls into the non-Pi static fallback that sets
`mcpTools: true`). The runner delivers tools over MCP — the same internal `agenta-tools`
loopback HTTP channel Claude uses. No Pi built-in tool names are forwarded; if any appear in
the request, `CodexHarness` drops them with a warning.

## Permissions

No static permission/config file is written in v1 (deferred). The permission policy
(`permissionPolicy`) is carried through and answers any tool-use gate at the ACP session level.

## Tracing

Codex is traced from the ACP event stream, identical to Claude. The runner subscribes to
`session/update` notifications and builds the same span tree (`invoke_agent → turn → chat +
execute_tool`). Codex does not self-instrument.

## Models

Codex is OpenAI-locked. The capabilities table publishes the known model ids under the
`openai` provider family (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, etc.). The runner passes the
requested model to the session and reports whichever model the harness actually used.

## What is deferred

- Static permission/config files (the `~/.codex/config.toml` or equivalent). When Codex gates
  tools at runtime, mirror the Claude `wire_harness_files` approach with a `codex_settings.py`
  equivalent.
- Daytona (remote) sandbox support. Remote Codex is a matrix-fill item; the credential upload
  path would mirror `prepareDaytonaPiAssets` for the codex auth file.
