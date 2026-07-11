# Status

## Current state

Planning workspace complete; awaiting owner review. Design only, no runtime code changed.

## Timeline

- 2026-07-11: Workspace created (README, context, research, plan, open-questions). All
  research anchors verified against `gitbutler/workspace` on this date. Draft PR opened
  for review.

## Decisions recorded

- Owner (2026-07-11): API-hosted tool gateway rejected; sandbox talks only to the runner;
  relay polling latency addressed here as its own feature. Source:
  `../mcp-delivery-architecture/gateway-mcp-location.md` (decision section).
- This plan (proposed, not yet approved): events are wake signals only (plan.md decision
  1); Daytona hop 2 uses a re-issued bounded watch exec (decision 2); hop 1 watch lives in
  the shared `relayToolCall` (decision 3); poll constants unchanged initially (decision
  4); one new flag plus one window variable (decision 5).

## Verification notes

- File:line anchors in research.md were read directly from the working tree, not quoted
  from prior docs. Re-verify before implementation; `relay.ts`, `dispatch.ts`, and
  `sandbox_agent.ts` are active files.
- The `runProcess` blocking semantics and `timeoutMs`/`timedOut` fields were verified
  against the installed sandbox-agent SDK type definitions.
- Daytona-side limits on held execs are NOT verified (open question 1).

## Blockers

None for review. Open question 1 gates the Daytona default-on step only.

## Next steps

1. Owner review and interview on the draft PR.
2. Answer open questions 1 and 2.
3. Implement slice 1 (in-process watches) via the implement-feature flow.
