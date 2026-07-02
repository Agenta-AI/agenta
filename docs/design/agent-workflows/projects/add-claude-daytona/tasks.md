# Claude on Daytona — tasks

## Done

- [x] Research: how Pi-on-Daytona and codex-on-Daytona work; what already works for claude
  x daytona on this base (managed key, harnessFiles, binary auto-install); the one gap
  (own-login upload); daemon user/home verification (`sandbox` / `/home/sandbox`)
- [x] `daytona.ts`: add `DAYTONA_CLAUDE_DIR`, `uploadClaudeAuthToSandbox`,
  `prepareDaytonaClaudeAssets`
- [x] `sandbox_agent.ts`: call `prepareDaytonaClaudeAssets` in the `if (plan.isDaytona)`
  block, next to `prepareDaytonaPiAssets`
- [x] Unit tests: extend `sandbox-agent-daytona.test.ts` with claude coverage (managed
  no-upload, self-managed allow-list-only upload with a decoy file, missing file, non-claude
  no-op, both dir overrides)

## Integration test (requires live Daytona daemon)

- [ ] Smoke: `harness="claude" sandbox="daytona"` returns output + trace
- [ ] Managed credential: only `ANTHROPIC_API_KEY` in daemon env; no `.credentials.json`
  written in sandbox
- [ ] Self-managed: local `.credentials.json` uploaded into sandbox, `settings.json` not
  overwritten by the host copy

These cannot run in CI without a Daytona API key and a running daemon; mark them
`@live-daemon` in a future test file when the infra is available.

## Explicitly not fixed here

- [ ] Gateway/custom tools on claude x daytona hard-fail at delivery (tracked in
  `gateway-tool-mcp/status.md`, not this project)

## Foundation fold-in (deferred)

When the generic remote-bootstrap seam lands:
- `uploadClaudeAuthToSandbox` becomes a credential writer passed to the generic bootstrap
- `prepareDaytonaClaudeAssets` becomes a call into `prepareRemoteHarnessAssets`
- `DAYTONA_CLAUDE_DIR` moves to the shared constants, alongside `DAYTONA_PI_DIR` and
  `DAYTONA_CODEX_DIR`
