# Status

## Current state

Review round addressed; awaiting owner re-review on PR #5232. Design only, no runtime
code changed.

## Timeline

- 2026-07-11: Workspace created (README, context, research, plan, open-questions). All
  research anchors verified against `gitbutler/workspace` on this date. Draft PR #5232
  opened for review.
- 2026-07-11 (later): Review round folded in. Codex (xhigh) raised three blocking
  defects, all adopted: atomic temp-plus-rename publication (plan.md decision 2), the
  coalesced single-flight activity source replacing the bare promise race (decision 3),
  and suspend-remote-polling-while-watch-healthy with honest request-volume numbers
  (decision 4). Codex P1s adopted: the relay-client/relay-protocol extraction as slice
  0 of this project, watcher hardening, per-hop flags, expanded test plan. CodeRabbit's
  four inline comments addressed: held-request abort on window end and relay stop,
  argv-safe script arguments, window validation and clamping, and the three-way latency
  definition with capacity assumptions as rollout gates. Owner framing points
  addressed: writer coverage (Pi, local Claude, the shim) stated up front; rejected
  alternatives moved into an explicit rejected subsection.

## Decisions recorded

- Owner (2026-07-11): API-hosted tool gateway rejected; sandbox talks only to the runner;
  relay polling latency addressed here as its own feature. Source:
  `../mcp-delivery-architecture/gateway-mcp-location.md` (decision section).
- Cross-project (2026-07-11): this project owns the `tools/relay-client.ts` and
  `tools/relay-protocol.ts` extraction as slice 0; #5234 consumes it.
- This plan (proposed, not yet approved): events are wake signals only (decision 1);
  publication is atomic via temp name plus rename (decision 2); the wake seam is a
  coalesced single-flight activity source (decision 3); Daytona hop 2 uses a re-issued
  bounded watch exec that suspends remote polling while healthy, with a 30 s safety
  poll kept deliberately (decision 4); the extraction is slice 0 (decision 5); idle
  backoff survives only in fallback mode (decision 6); three per-hop config variables
  with a validated, clamped window (decision 7).

## Verification notes

- File:line anchors in research.md were read directly from the working tree, not quoted
  from prior docs. Re-verify before implementation; `relay.ts`, `dispatch.ts`, and
  `sandbox_agent.ts` are active files.
- The `runProcess` blocking semantics and `timeoutMs`/`timedOut` fields were verified
  against the installed sandbox-agent SDK type definitions, as was the existence of
  `moveFs` (`post_v1_fs_move`); its rename atomicity is NOT verified (open question 2).
- Daytona-side limits on held execs are NOT verified (open question 1, a rollout gate).

## Blockers

None for review. Open questions 1 and 2 gate the Daytona work (question 2 gates slice
1's Daytona side; question 1 gates the default flip only).

## Next steps

1. Owner re-review on the draft PR.
2. Implement slice 0 (the extraction) via the implement-feature flow; #5234 rebases to
   consume it.
3. Verify `moveFs` atomicity during slice 1 (open question 2).
