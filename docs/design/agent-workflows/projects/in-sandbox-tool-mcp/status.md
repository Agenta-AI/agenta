# Status

**State: IMPLEMENTED, draft PR up for review.** Slices 0-1 landed on lane
`feat-in-sandbox-tool-mcp` (stacked on `feat-event-driven-tool-relay`, PR #5243, the
relay-module prerequisite). Slice 2 ran: every runnable live cell is green; the cells that
need a real Claude model turn on Daytona are credit-blocked and recorded as the explicit
merge gate below. Evidence: [spike-restart.md](spike-restart.md) (slice 0) and
[qa-slice2.md](qa-slice2.md) (slice 2).

## Merge gate (do not merge until)

The Claude+Daytona EXECUTION cells (a real gateway tool called by the model, plus the
warm-live-reuse and stopped-VM-restart turns) are blocked on Daytona/Anthropic credit.
The delivery mechanism is proven live (see qa-slice2 cell 3: no gate refusal, assets
uploaded, `agenta-tools` stdio entry advertised, session created, adapter spawned the
shim) and the restart respawn is proven by the slice-0 spike, but "the tool executes and
the result reaches the answer" has not run end to end on Daytona. Re-run qa-slice2 cells
3 and 7 once credit is restored, then flip the PR to ready.

## Done

- 2026-07-11: workspace created; prior art reconciled; PR #4873 mined as the revival base;
  owner decisions encoded in [context.md](context.md); A2 recommendation written.
- 2026-07-11 (late): Codex xhigh review folded in — conditional A2 gated on a slice-0
  restart spike, relay modules handed to PR #5232/#5243, specs moved to a file, v1 cut to
  spike + shim + live acceptance. Details in the decision log.
- 2026-07-12 (overnight run): **slice 0 executed live.** Verdict: `session/load` respawns
  the stdio MCP subprocess on the pinned adapter (`@zed-industries/claude-agent-acp 0.22.2`,
  snapshot `agenta-sandbox-pi`, in-sandbox `sandbox-agent 0.5.0-rc.2`): new pid, fresh
  `initialize` + `tools/list`, `loadedFromContinuity=true`. **A2 locked, no engine fork
  needed.** Evidence + caveats (Pi login upload is Pi-only; `pauseSandbox()` clears
  `sandbox.sandboxId`) in [spike-restart.md](spike-restart.md).
- 2026-07-12: **slice 1 implemented and committed** (4 commits on
  `feat-in-sandbox-tool-mcp`): `tools/tool-mcp-stdio.ts` (9.6 kB bundle, NDJSON JSON-RPC,
  consumes the shared relay client, specs from a FILE via
  `AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE`), `engines/sandbox_agent/tool-mcp-assets.ts`
  (fail-loud always-write upload, `SANDBOX_AGENT_RELAY_MCP_BUNDLE` override),
  the dedicated typeless `agenta-tools` entry constructor in `mcp.ts` (McpServerStdio moved
  out of mcp-bridge; `toAcpMcpServers` still cannot emit stdio), the narrowed run-plan gate
  (executable tools on Daytona pass; client tools and non-Daytona remotes refuse loud; the
  reserved name is refused at declaration + materialization), and — from the review round —
  the relay execution guard now built for EVERY harness (deny enforced everywhere; ask
  consumes the Pi grant ledger on Pi, passes on MCP harnesses whose own dialog gates the
  call; forged-ask residual documented as a follow-up). Lane tip verified standalone:
  typecheck clean, 994/994 unit tests green.
- 2026-07-12: **slice 2 ran** ([qa-slice2.md](qa-slice2.md)): Claude+local+gateway PASS
  (loopback channel, echo token end to end); Pi+Daytona+gateway PASS (file relay);
  Claude+Daytona+gateway cold MECHANISM PASS (no refusal, shim uploaded + advertised,
  session created; model turn blocked upstream by credit); Claude+Daytona+client-tool
  refusal PASS (29 ms, zero sandboxes); Claude+Daytona no-tools PASS (no shim upload);
  reserved-name rejection PASS. Warm/restart cells BLOCKED on credit (spike covers the
  respawn mechanism). Teardown verified twice: 0 sandboxes left.
- 2026-07-12: living docs synced in the same PR (runner-to-mcp-server interface page,
  interface index, harness-adapters, mcp-models, permission-responder, tools.md,
  ground-truth.md, claude-code.md, running-the-agent.md).

## Known caveats / deferred (each its own decision, see plan.md follow-ups)

- Client tools through the shim (Daytona client-tool bridge workspace owns it).
- Ask-grant parity for MCP harnesses in the relay guard (a forged relay file can trigger
  an ask-tool without a dialog on the MCP path; deny is enforced runner-side everywhere).
- Shim-side abort: the shim passes no AbortSignal into `relayToolCall`; a harness-cancelled
  `tools/call` runs to completion/timeout (relay timeout residue is #5243-owned).
- Codex-on-Daytona, snapshot bake, Pi-as-MCP-client, watch adoption in the shim, replay
  capture: unchanged follow-ups.
- Dev-stack operational note: the running dev sidecar containers were built from an image
  whose CMD does not rebuild bundles on restart; loading a new shim build needs a
  `docker cp` of `scripts/build-extension.mjs` (or the dist file) before the restart.
  Deployed images bake the bundle at build time and are unaffected. Also, the deployed
  main runner carries `DAYTONA_SNAPSHOT=daytona-small` (the daemon-less code-evaluator
  snapshot) because the env file's API-scoped value leaks into the runner service; the
  sub-sidecar has the correct `agenta-sandbox-pi`. Worth an env-file sweep.
- QA note: the sidecar's Codex-subscription Pi login cannot set `openai/gpt-4o-mini`
  (fail-loud ModelNotSettableError); Pi QA cells use `openai-codex/gpt-5.4-mini`.

## Next

1. Owner review of the draft PR (interview against [open-questions.md](open-questions.md);
   the conditional A2 approval is now backed by the spike).
2. Restore Daytona/Anthropic credit, re-run qa-slice2 cells 3 + 7 (execution, warm reuse,
   stopped-VM restart, tool-set change, network-off), record them, flip the PR to ready.

## Decision log

- 2026-07-11: transport recommendation flipped from A1 (HTTP loopback) to A2
  (harness-spawned stdio, PR #4873), driven by the warm-reuse lifecycle (PR #5225).
- 2026-07-11 (late, Codex review fold): A2 approval made conditional on the slice 0 restart
  spike; relay-module ownership handed to PR #5232; the standalone shared-handler slice cut;
  specs delivery decided as a file; v1 reduced to spike + shim + live acceptance.
- 2026-07-11: the daemon-spawned variant recognized as the same mechanism as A2.
- 2026-07-12: slice-0 spike PASSED; A2 locked unconditionally (no cold-createSession
  fallback needed). Relay guard extended to every harness after the implementation review
  found the plan's forged-file invariant unimplemented on the new path; ask-grant parity
  for MCP harnesses recorded as a follow-up rather than blocking v1.
