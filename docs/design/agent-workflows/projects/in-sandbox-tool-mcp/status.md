# Status

**State: DESIGN ONLY, awaiting owner review.** No runtime code changed. The PR carrying this
workspace is the review surface; the owner will interview on it.

## Done

- 2026-07-11: workspace created. Prior art read and reconciled (`claude-daytona-tools`,
  `remote-tools-delivery`, `mcp-delivery-architecture` including the 2026-07-11 decision in
  `gateway-mcp-location.md`, `gateway-tool-mcp`). PR #4873 mined; its stdio implementation
  is the revival base. Current code re-verified against the working tree (anchors in
  [research.md](research.md)), including the warm-reuse lifecycle from PR #5225 and the
  client-tool pause semantics on the local channel.
- Owner decisions of 2026-07-11 encoded in [context.md](context.md): runner-only sandbox
  communication (API gateway rejected), user MCP HTTP-only permanently with API-key-header
  auth now and OAuth as future work, platform tools via an in-sandbox MCP server, and
  unification with Pi as the primary design goal.
- Recommendation written in [plan.md](plan.md): A2 (harness-spawned stdio shim) as the one
  transport, shared handler + relay-writer modules with a golden byte-contract test as the
  unification path, slices 1-4, and the live-QA matrix including the warm-reuse cells.
- 2026-07-11: cross-consistency review round (requested by the owner alongside his own
  review of the event-driven-tool-relay PR) folded in. Corrections: the relay dir is an
  ephemeral sibling keyed by `basename(cwd)`, not derived from the durable cwd; the
  orphaned-request risk narrowed to warm-continued turns (`workspace.ts:60-66` already
  clears cold builds). Additions: the `waitForRelayResponse` seam contract and landing
  order with the sibling, the bearer layering rule and ordering with
  `mcp-client-tool-continuation`, the unowned Daytona client-tool bridge cross-reference,
  the crash-after-write at-least-once note, and the `best_effort` clarification on the
  network-off QA cell. Combined landing order:
  [../mcp-delivery-architecture/orchestration.md](../mcp-delivery-architecture/orchestration.md).
- 2026-07-11 (late): Codex xhigh review of this workspace folded in. The owner was asleep;
  per his standing simplify-aggressively instruction the cuts were adopted rather than
  argued, and every adoption is reversible at his review. Verdict: approve A2
  conditionally, reject the earlier scope. Changes: a new slice 0 restart spike gates A2
  (the "correct by construction" claim was wrong; `session/load` may seed persisted
  `mcpServers` without respawning subprocesses, and the orphan-exit claim is weakened to an
  expectation); relay-module extraction moved out of this project entirely (PR #5232 owns
  `relay-client.ts`/`relay-protocol.ts` as its slice 0 and is now an explicit prerequisite,
  reversing the ordering the earlier consistency pass wrote); the standalone
  transport-neutral `mcp-handler.ts` slice is cut and the unification section rewritten
  honestly (Pi never speaks MCP; the real sharing is the relay client and file protocol);
  specs move from an unbounded env variable to a file, decided now; v1 cuts moved to
  explicit follow-ups (client tools, Codex-on-Daytona, snapshot bake, U2, watch adoption,
  mandatory replay capture); warm-reuse edges added (session/load after VM stop,
  sanitized-ID collision, bundle-version skew, partial request visibility via #5232's
  atomic-rename amendment); security separation made structural (dedicated internal entry
  constructor/type, reserved-name rejection for user config, `toAcpMcpServers` never
  generalized to stdio); naming fixed (`tool-mcp-stdio.ts`, `internal-tool-mcp-handler.ts`
  if a handler exists, upload helpers under `engines/sandbox_agent/`, ACP entry shapes out
  of `mcp-bridge.ts`).

## Next

1. Owner review of this workspace (interview against
   [open-questions.md](open-questions.md), especially the conditional A2 approval and the
   specs-file decision).
2. On approval: run slice 0 (the restart spike) first. Implementation waits for PR #5232
   slice 0 (relay module extraction); then slice 1 (#4873 revival over the consumed
   modules), then slice 2 (live acceptance). Coordinate lane usage on the agent board.

## Blockers

- Implementation waits on PR #5232 slice 0 (relay module extraction), now an explicit
  prerequisite.
- Slice 0 and slice 2 need Daytona credit; slice 2 also needs the `pi-agents` project's
  live Composio connections (the same live-QA prerequisites recorded in
  `claude-daytona-tools/design.md`).

## Decision log

- 2026-07-11: transport recommendation flipped from A1 (HTTP loopback,
  `claude-daytona-tools`) to A2 (harness-spawned stdio, PR #4873), driven by the warm-reuse
  lifecycle (PR #5225) and the existence of tested A2 code. Recorded in
  [plan.md](plan.md); awaiting owner confirmation (open question 1).
- 2026-07-11 (late, Codex review fold): A2 approval made conditional on the slice 0 restart
  spike; relay-module ownership handed to PR #5232; the standalone shared-handler slice cut;
  specs delivery decided as a file; v1 reduced to spike + shim + live acceptance with
  everything else an explicit follow-up. Adopted while the owner slept, flagged for his
  review, reversible.
- 2026-07-11: the daemon-spawned variant from `remote-tools-delivery` recognized as the
  same mechanism as A2 (the daemon already forwards session MCP entries; the adapter
  spawns them), so no daemon change is requested from the sandbox-agent package.
