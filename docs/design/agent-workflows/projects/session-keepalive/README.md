# Session keep-alive

Keep the harness session alive for a TTL after a turn ends, so the next message (or an approval decision) continues the same live session with full native memory. Cold replay stays as the universal fallback. Flag-gated, local-only first, runner-only.

## Files

- [context.md](context.md) — why this exists, goals, non-goals, background, and how it relates to the other features.
- [plan.md](plan.md) — the plan. Contains the Q&A section answering Mahmoud's questions, the "could a minimal version work in an hour?" answer, the slice sizes and risks, flags, failure modes, and the verification plan.
- [status.md](status.md) — source of truth for progress, decisions, and the drift check of the research against current code.
- [open-questions.md](open-questions.md) — decisions that refine defaults and edge behavior; none blocks slice 1.
- [architecture-notes.md](architecture-notes.md) — the code-grounded research the plan builds on. Read this for the exact line references and the full design.

## Start here

Read context.md, then plan.md. The plan's Q&A section and the one-hour assessment are the parts Mahmoud asked for.

## Related

- [../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md) — why the agent has no memory. This feature is Part 3, option 2.
- [../harness-session-resume/plan.md](../harness-session-resume/plan.md) — option 3, the complementary feature. Build it after keep-alive.
