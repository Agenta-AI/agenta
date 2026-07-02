# Codex harness on Daytona — specs

## Scope

In: `harness="codex" sandbox="daytona"` runs with both credential modes. Out: Python SDK
changes, wire contract changes (the codex-local branch already covers those).

## Behavior

- A codex-on-Daytona run provisions `~/.codex/auth.json` into the remote sandbox before
  `createSession` — managed mode writes the resolved key; self-managed uploads the runner's
  own local file.
- The codex binary is auto-installed by the daemon on `createSession({ agent: "codex" })`
  (the same auto-install the local path gets); no explicit install step needed.
- `OPENAI_API_KEY` already flows into the Daytona create-time env via `daytonaEnvVars` +
  `buildDaytonaCreate` (it is in `plan.secrets` on a managed run); the auth file write is
  additive, not a replacement.
- Runs mode `agent-full-access` (the daemon's codex ACP bridge default).
- Tracing, tool delivery (MCP), model selection, and the cookie fetch all apply unchanged —
  they are harness-agnostic in the runner.

## Contracts

- No wire changes. `prepareDaytonaCodexAssets` is runner-internal.
- `DAYTONA_CODEX_DIR` defaults to `/home/sandbox/.codex`; overridable via
  `AGENTA_AGENT_SANDBOX_CODEX_DIR` (mirrors `DAYTONA_PI_DIR` / `AGENTA_AGENT_SANDBOX_PI_DIR`).

## Decisions

1. **Credential gate**: reuse `shouldUploadOwnLogin` from `run-plan.ts` — same rule as Pi.
2. **Auth file format**: `{"OPENAI_API_KEY": "<key>"}` — matches `writeCodexAuthFile` (local).
3. **Managed key source**: prefer `OPENAI_API_KEY` over `CODEX_API_KEY` (both are in
   `KNOWN_PROVIDER_ENV_VARS`; managed runs resolve to `OPENAI_API_KEY`).
4. **Foundation fold-in**: the new functions are codex-specific clones of the Pi shape;
   when the foundation seam lands they become calls into the generic bootstrap abstraction.

## Acceptance

- Unit: managed run writes auth.json with the resolved key; self-managed uploads local file;
  non-codex run is a no-op; managed with no key does nothing.
- Integration (requires live daemon): codex-on-Daytona returns output and trace. Marked
  as requiring live daemon (cannot run in CI without Daytona API key).
