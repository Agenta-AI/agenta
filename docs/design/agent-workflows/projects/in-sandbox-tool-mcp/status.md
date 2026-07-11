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

## Next

1. Owner review of this workspace (interview against
   [open-questions.md](open-questions.md), especially the A1-to-A2 flip and the client-tool
   sequencing).
2. On approval: implement slice 1 (shared modules + golden), then slice 2 (#4873 revival),
   then slice 3 (live QA + replay pin). Coordinate lane usage on the agent board; check the
   `event-driven-tool-relay` sibling's state before touching `relay-client.ts` internals.

## Blockers

None for the design. Implementation slice 3 needs Daytona credit and the `pi-agents`
project's live Composio connections (the same live-QA prerequisites recorded in
`claude-daytona-tools/design.md`).

## Decision log

- 2026-07-11: transport recommendation flipped from A1 (HTTP loopback,
  `claude-daytona-tools`) to A2 (harness-spawned stdio, PR #4873), driven by the warm-reuse
  lifecycle (PR #5225) and the existence of tested A2 code. Recorded in
  [plan.md](plan.md); awaiting owner confirmation (open question 1).
- 2026-07-11: the daemon-spawned variant from `remote-tools-delivery` recognized as the
  same mechanism as A2 (the daemon already forwards session MCP entries; the adapter
  spawns them), so no daemon change is requested from the sandbox-agent package.
