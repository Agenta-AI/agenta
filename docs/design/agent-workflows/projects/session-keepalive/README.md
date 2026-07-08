# Session keep-alive

Keep the harness session alive for a TTL after a turn ends, so the next message (or an approval decision) continues the same live session with full native memory. Cold replay stays as the universal fallback. Flag-gated, local-only first, runner-only.

## Files

- [context.md](context.md): why this exists, goals, non-goals, background, and how it relates to the other features.
- [architecture-notes.md](architecture-notes.md): the deep companion. Three parts: how the runner works today (the current flow, the process tree, the teardown, the four approval gates), what keep-alive changes (before/after with worked examples), and every design decision with its problem, options, trade-offs, and reason. Read this to understand the feature.
- [plan.md](plan.md): the plan. The Q&A answering Mahmoud's questions (with measured costs and the Claude-vs-Pi approval story), the slice sizes and risks, the one-hour assessment, flags, failure modes, and the verification plan. Builds on architecture-notes.md by reference.
- [open-questions.md](open-questions.md): decisions that refine defaults and edge behavior; none blocks slice 1.
- [status.md](status.md): progress, decisions, provenance, measured research figures, the drift check against current code, and recorded follow-ups. The meta and provenance home.

## Start here

Read context.md, then architecture-notes.md (Part 1 explains how things work today before anything changes), then plan.md.

## Related

- [../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md): why the agent has no memory. This feature is Part 3, option 2.
- [../harness-session-resume/plan.md](../harness-session-resume/plan.md): option 3, the complementary feature. Build it after keep-alive.
