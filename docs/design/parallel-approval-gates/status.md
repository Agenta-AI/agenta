# Status

**Phase: research + plan complete. Awaiting Mahmoud's decision on the recommendation.**

- 2026-07-06: workspace created. All mechanics verified against source (runner,
  claude-agent-acp 0.23.1, Claude Agent SDK 0.2.83 cli.js, sandbox-agent 0.4.2,
  vercel adapter, AI SDK 6.0.0-beta.150, playground). No product code touched.

## Decisions taken

- No frontend tool-name special-casing (Mahmoud, hard constraint).
- F-040 core rule stays: never reply to a harness gate that needs a human.
- Recommendation on the table: Option A first (small, honest states, no contract
  change), Option B layered on top (synthetic sibling gates + args-trust guard;
  drain only if data demands it). See options.md.

## Key verified facts driving the design

- The Claude CLI serializes gated write tools; the second gate reaches the runner
  only in the teardown race. "Wait and collect gates" is impossible; batching must
  synthesize from the runner's own tool_call record.
- Everything downstream of the runner already supports N approvals per turn: wire
  parts, AI SDK client, ApprovalDock queue + Approve all, resume predicate, ingress
  folding, multi-key decision store, cold-replay matching.
- The losing call's args can be `{}` at pause time (refresh races teardown), so
  Option B needs an args-trust guard with Option A as its fallback.

## Blockers

None.

## Next

1. Mahmoud reviews options.md + plan.md, picks scope (A only, or A then B).
2. Implement Phase 1 per plan.md (runner-only, unit tests first).
3. Live repro verification on the dev stack, then the replay regression capture.
