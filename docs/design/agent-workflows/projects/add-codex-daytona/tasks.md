# Codex harness on Daytona — tasks

## Done

- [x] Research: how Pi-on-Daytona works; why `prepareDaytonaPiAssets` skips non-Pi;
  what codex needs remotely (auth.json, no binary install needed)
- [x] `daytona.ts`: add `DAYTONA_CODEX_DIR`, `uploadCodexAuthToSandbox`,
  `prepareDaytonaCodexAssets`
- [x] `sandbox_agent.ts`: call `prepareDaytonaCodexAssets` in the `if (plan.isDaytona)` block
- [x] Unit tests: extend `sandbox-agent-daytona.test.ts` with codex coverage

## Integration test (requires live Daytona daemon)

- [ ] Smoke: `harness="codex" sandbox="daytona"` returns output + trace
- [ ] Managed credential: only `OPENAI_API_KEY` in daemon env; auth.json written in sandbox
- [ ] Self-managed: local `~/.codex/auth.json` uploaded into sandbox

These cannot run in CI without a Daytona API key and a running daemon; mark them
`@live-daemon` in a future test file when the infra is available.

## Foundation fold-in (deferred)

When the generic remote-bootstrap seam lands:
- `uploadCodexAuthToSandbox` becomes a credential writer passed to the generic bootstrap
- `prepareDaytonaCodexAssets` becomes a call into `prepareRemoteHarnessAssets`
- `DAYTONA_CODEX_DIR` moves to the shared constants
