# Tasks

Design-only. Nothing below is built yet; this is the implementation queue for the recommended
fix (specs.md candidate (b), daemon-spawned in-sandbox relay client), once approved.

## 0. Pre-work / confirm before starting

- [ ] Confirm with the daemon owner (`sandbox-agent` package, a separate repo/dependency from
      this one) whether it can spawn a sibling process, or attach an extra stdio MCP server that
      runs INSIDE the sandbox, alongside a non-Pi harness (Claude's ACP agent process). This is
      the load-bearing assumption for candidate (b); if it's a hard no, fall back to specs.md
      candidate (a) sub-option 2 (tunnel) instead and re-plan from there.
- [ ] Confirm whether Claude's ACP agent (`@zed-industries/claude-agent-acp`) exposes any
      extension/plugin hook analogous to Pi's `ExtensionAPI` — if it does, sub-option 2 of
      candidate (b) (ship a bundled shim like Pi's) may be simpler than daemon-spawning a
      separate process. Time-boxed spike, not a blocker for the daemon-side investigation above.

## 1. Build the in-sandbox relay-client shim

- [ ] Extract the relay-writing logic Pi's extension uses
      (`extensions/agenta.ts` `registerTools` → `runResolvedTool`) into a harness-agnostic,
      standalone shim: given `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` + `AGENTA_AGENT_TOOLS_RELAY_DIR`
      in its environment, expose those tools over whatever local protocol the daemon needs
      (stdio MCP is the natural choice, since it mirrors the ACP `McpServerStdio` shape already
      used for user-declared stdio servers — except this one runs inside the sandbox, so the
      `USER_MCP_UNSUPPORTED_MESSAGE` security concern does not apply).
  - Reuse `EMPTY_OBJECT_SCHEMA`, `promptSnippet`/`promptGuidelines`-equivalent tool metadata
    shaping from `extensions/agenta.ts` where useful, but the shim does not need Pi's
    `ExtensionAPI` — it is a standalone MCP server binary, esbuild-bundled the way the Pi
    extension already is (`pnpm run build:extension`).
- [ ] Decide how the shim reaches the sandbox filesystem for the relay dir: it should be the
      SAME relay dir the runner-side poller already watches (`plan.relayDir`), so no new relay
      protocol is needed — only a new writer.

## 2. Wire the shim into a non-Pi remote session

- [ ] In `engines/sandbox_agent.ts`, for a non-Pi harness on a remote sandbox with
      `executableToolSpecs.length > 0`, have the daemon start the shim (mechanism depends on
      task 0's finding) and add it to the session's `mcpServers` list instead of (or alongside)
      today's `buildSessionMcpServers` internal-channel call.
- [ ] Update `engines/sandbox_agent/mcp.ts` `buildSessionMcpServers`: the Daytona branch currently
      returns `{ servers: [], close: async () => {} }` for the internal channel unconditionally.
      Replace that with "start the in-sandbox shim and return its MCP server entry" for the
      non-Pi + remote case. Keep the local-loopback path (`buildToolMcpServers`) for `!isDaytona`
      unchanged — this fix only targets the remote case.
- [ ] Correct the log this project's interim fix made conditional on `isPi`
      (`mcp.ts`, "daytona: N gateway tool(s) delivered via the file relay") so it fires for the
      NEW real delivery path too, once true.

## 3. Remove the interim gate

- [ ] Delete (or narrow) the `run-plan.ts` `REMOTE_TOOLS_UNSUPPORTED_MESSAGE` gate added by the
      interim fix, once the shim path is implemented and tested end-to-end. Narrow rather than
      delete outright if the fix only covers Daytona and a future non-Daytona remote provider is
      added later without the same shim support — keep the gate provider-scoped in that case.
- [ ] Update/remove the four unit tests in `tests/unit/sandbox-agent-run-plan.test.ts`
      (`describe("remote-tools gate ...")`) that currently assert the refusal; replace with tests
      asserting the shim path is wired (claude x daytona x tools → session includes the shim MCP
      server, tool call round-trips through the relay dir).
- [ ] Revert the three Layer-2 network-boundary tests that were switched from `harness: "claude"`
      to `harness: "pi_agenta"` as part of the interim fix (`sandbox-agent-run-plan.test.ts`,
      search "Pi (not claude)") back to exercising Claude directly, since the F1 gate they were
      moved to avoid will no longer intercept them first — OR keep both harnesses covered if the
      Layer-2 network-bypass concern (code/gateway tools running on the runner host bypass the
      sandbox network boundary) still applies to the new shim path. Re-verify: does the in-sandbox
      shim change WHERE execution happens? (No — `runResolvedTool` still executes on the runner
      via the relay; only the advertisement/discovery moved into the sandbox.) So the Layer-2
      network-boundary gate's reasoning is unchanged and this test set can stay dual-covered
      (Pi and Claude) rather than only reverted.

## 4. Auth / security review (if candidate (a) is chosen instead)

Only applies if task 0 forces a pivot to candidate (a):

- [ ] Design a per-run bearer token for the internal tool-MCP channel; thread it through
      `McpServerHttp.headers` the way `toAcpMcpServers` already does for user HTTP MCP servers.
- [ ] Threat-model the tunnel/proxy exposure (reuse or extend the SSRF-style review already done
      for user HTTP MCP in `mcp.ts` `validateUserMcpUrl` / `isInternalHost` — the new channel is
      the INVERSE direction, so the guard needs to protect the runner's endpoint from arbitrary
      external callers, not protect the runner from calling out to one).
- [ ] Security review sign-off before removing the interim gate for the reachable-URL path.

## 5. Tests (either candidate)

- [ ] Unit: shim/relay-writer logic in isolation (given specs + relay dir, writes the expected
      `<id>.req.json`, parses `<id>.res.json`), mirroring `tests/unit/extension-tools.test.ts`'s
      coverage of Pi's `registerTools`.
- [ ] Unit: `buildSessionMcpServers` non-Pi + Daytona + tools now returns a non-empty server list
      (contrast with today's `session-mcp-layering.test.ts` case asserting the loopback channel
      is ABSENT on Daytona — that assertion should be updated to assert the NEW channel present).
- [ ] Integration/acceptance (if the harness exists in this repo's test tooling): an end-to-end
      Claude-on-Daytona run with a gateway tool that actually gets called and returns a result,
      closing the loop the interim gate currently blocks at plan-build time.
- [ ] Regression: keep a test pinning that user stdio MCP (`USER_MCP_UNSUPPORTED_MESSAGE`) is
      UNCHANGED by this work — the new in-sandbox server is internal/synthesized, not user-facing,
      and must not be reachable through `request.mcpServers`.

## Dependencies / sequencing

- Task 0 blocks everything else (chooses (a) vs (b)).
- Tasks 1-2 (build + wire the shim) block task 3 (removing the interim gate) — the gate must
  stay live until its replacement is proven in task 5's tests.
- Task 4 only applies to the candidate-(a) fallback branch.
