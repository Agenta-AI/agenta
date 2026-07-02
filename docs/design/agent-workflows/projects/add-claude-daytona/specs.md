# Claude on Daytona — specs

## Scope

In: `harness="claude" sandbox="daytona"` own-login (`runtime_provided`) credential
provisioning, both credential modes covered end to end. Out: Python SDK changes, wire
contract changes, the claude binary install (already auto-installed by the daemon), the
gateway-tool-mcp delivery fix (tracked separately).

## Behavior

- A Claude-on-Daytona run provisions `.credentials.json` into the remote sandbox before
  `createSession` when the run is self-managed (`credentialMode="runtime_provided"`, or
  back-compat: no `credentialMode` and no api key). Managed runs (`credentialMode="env"`)
  need no file upload -- `ANTHROPIC_API_KEY` already reaches the sandbox daemon's env via
  `daytonaEnvVars`.
- Only `.credentials.json` is uploaded, matching the E2B allow-list exactly. `settings.json`
  is never uploaded from the host: the run's own rendered `.claude/settings.json` (delivered
  through `harnessFiles` / `prepareWorkspace`) must win. No directory scan
  (`readdirSync`) -- an explicit allow-list only.
- The claude binary is auto-installed by the daemon on `createSession({ agent: "claude" })`;
  no explicit install step is added (mirrors the codex-daytona decision not to add one).
- Tracing, tool delivery (subject to the known gateway-tool-mcp limitation below), model
  selection, and the cookie fetch all apply unchanged -- they are harness-agnostic in the
  runner.

## Contracts

- No wire changes. `prepareDaytonaClaudeAssets` is runner-internal.
- `DAYTONA_CLAUDE_DIR` defaults to `/home/sandbox/.claude`; overridable via
  `AGENTA_AGENT_SANDBOX_CLAUDE_DIR` -- the SAME env var name the E2B implementation already
  defines for its own `E2B_CLAUDE_DIR` override, since each harness has one override name
  shared across sandbox kinds (mirrors `AGENTA_AGENT_SANDBOX_PI_DIR`,
  `AGENTA_AGENT_SANDBOX_CODEX_DIR`).
- Source dir on the host: `process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")`,
  identical to the E2B implementation's source resolution.

## Decisions

1. **Credential gate**: reuse `shouldUploadOwnLogin` from `run-plan.ts` -- same rule as Pi,
   codex, and E2B Claude.
2. **Allow-list, not directory upload**: `[".credentials.json"]` only. This is the E2B
   implementation's post-security-fix shape (a prior E2B iteration uploaded the whole
   `~/.claude` dir and over-shared `.mcp.json`/`settings.json`/`history.jsonl`; do not
   reintroduce that on Daytona).
3. **Gate on `plan.acpAgent === "claude"`**, not `plan.isPi` -- Claude and Pi are mutually
   exclusive ACP agents in `run-plan.ts`, so this reads directly rather than through a
   negation.
4. **Best-effort, per-file**: a missing or unreadable file is logged and skipped; it never
   aborts the run. A sandbox FS failure (mkdir or write) is logged, never thrown.
5. **Foundation fold-in**: `prepareDaytonaClaudeAssets` / `uploadClaudeAuthToSandbox` are
   Claude-specific clones of the Pi and codex Daytona shapes; when the foundation seam lands
   they become calls into the generic bootstrap abstraction, and this fold-in note travels
   with the sibling codex-daytona and E2B-claude branches' identical notes.

## Known limitation (not fixed here)

Gateway/custom tools on claude x daytona are affected by the tool-delivery gap tracked in
`docs/design/agent-workflows/projects/gateway-tool-mcp/status.md`: a Claude run carrying
gateway/custom tools currently hits a hard failure (`ok:false`) at delivery rather than a
silent drop, because the internal MCP channel was disabled alongside the (correctly)
disabled user-facing stdio MCP. This applies uniformly across sandboxes (local, e2b,
daytona) and is not specific to the own-login change made here. Tool-less Claude runs and
Pi runs (which route tools through a different, unaffected channel) are not impacted. The
real fix (an internal HTTP MCP channel) is tracked in that design, including the open
question of Daytona loopback reachability -- not resolved here.

## Acceptance

- Unit: managed run uploads nothing; self-managed uploads only `.credentials.json` (a decoy
  `.mcp.json` present in the fixture dir must NOT be uploaded); a missing
  `.credentials.json` warns and does not throw; non-claude runs are a no-op; both
  `CLAUDE_CONFIG_DIR` and `AGENTA_AGENT_SANDBOX_CLAUDE_DIR` overrides are honored.
- Integration (requires live daemon): claude-on-Daytona returns output and a trace, for both
  credential modes. Cannot run in CI without a Daytona API key; deferred the same way the
  codex-daytona and E2B-claude integration tests are deferred (`describe.skip` / a future
  `@live-daemon` tag).
