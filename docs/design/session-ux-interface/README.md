# Session UX interface redesign

This workspace records the completed revision of the session-list interfaces introduced by the
v0.112 sessions UX stack.

## Reading order

1. [`context.md`](context.md) explains the user experience, goals, decisions, and non-goals.
2. [`implementation.md`](implementation.md) gives reviewers a concise code and runtime handoff.
3. [`qa-handoff.md`](qa-handoff.md) records verification evidence and remaining QA work.
4. [`research.md`](research.md) compares the proposed design with PR #5767 and records costs and
   regression risks.
5. [`plan.md`](plan.md) records the implementation phases, files, tests, and rollout order.
6. [`status.md`](status.md) records the implementation outcome and residual verification work.

The detailed interface review remains at
[`../session-ux-interface-review.md`](../session-ux-interface-review.md).

## Terms

- **Session:** The conversation or work container shown in session lists.
- **Turn:** One agent execution inside a session.
- **Automation:** A schedule or event subscription that invokes an agent.
- **Delivery:** The audit record for one automation firing. Every successful claim has a unique
  delivery ID.
- **Origin:** Who or what created a session. The current automated value is `trigger`; an absent
  value means unknown, not manual.
- **Expansion:** Optional response data that the caller requests because it costs another lookup,
  such as a message preview or current automation name.
- **Session attribution:** The stable relationship from a session to its origin, automation, and
  exact delivery.

## Implementation record

Implementation started from GitButler target `origin/release/v0.112.0` at `965851e15d`. No stacks
were applied at the start.

The implementation is complete and organized as a stacked review set. See `implementation.md` for
the review split and `qa-handoff.md` for verification evidence and residual risks.
