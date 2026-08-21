# Status

Last update: 2026-07-24 (design re-audit, no product code changed)

## Where things stand

- Original message-identity research DONE. See `research.md` and `fix-options.md`.
- Message identity fix MERGED in PR #5088 and present on `main`.
- Trace-continuation follow-up RE-AUDITED against current `main`. The current
  recommendation is in `trace-continuation-v2.md`; the exact scope and revised
  Medium estimate are in `trace-continuation-complexity.md`.
- Implementation remains OPEN in issue #5097. This workspace changes design docs only.

## Decisions already shipped in #5088

1. Assistant message identity lives in SDK routing, not the frontend or runner.
2. Continuation detection is "the inbound last message has role assistant", matching
   the AI SDK behavior. Approvals and client tools share it.
3. The batch channel follows the same stable-message-id rule.

## Follow-up decisions

1. `spanId` and `traceparent` are per-request protocol context owned by
   `AgentChatTransport`, not persistent UI-message metadata.
2. The transport keeps the latest trace/span context by stable assistant message id,
   so sequential resumes form a causal chain in one trace.
3. The UI message keeps stable `traceId` plus cumulative turn usage.
4. A growing trace needs scoped, bounded cache refresh; one immediate invalidation can
   race ingestion and cache a partial trace.
5. The wrong resumed-turn usage (`0/0/~62k`) remains a runner bug. The frontend total
   guard prevents that context-size number from corrupting the turn aggregate.

## Product decision before implementation

Confirm whether release acceptance requires one trace across a page reload. The
recommended first slice guarantees one trace for approvals and client tools handled
by the same mounted session transport. A reload intentionally starts a new transport
and therefore a new trace epoch.

Guaranteed reload continuity is a separate Medium slice: persist explicit trace/span
context in session records and restore the latest completed context into the new
transport.

## Next steps

1. Review `trace-continuation-v2.md`, then `trace-continuation-complexity.md`.
2. Decide the reload boundary above.
3. Implement the slices in the order listed in `trace-continuation-complexity.md`.

## Deferred

- Runner usage extraction for resumed ACP turns.
- Recomputing root-span cumulative metrics after late span ingestion.
- Manual playground QA from the delivery plan.
