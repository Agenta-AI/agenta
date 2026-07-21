# Status

**Last updated:** 2026-07-21

## Current stage

Planning workspace drafted. Problem, research, view catalog, and a sliced plan are written
and grounded in current code. No implementation has started. This is a design-workspace
only; no code, no branch, no commit.

## Locked decisions

- The agent Overview replaces the prompt-era composition (deployments / variants /
  evaluations) with agent-native views, gated by workflow kind — prompt-era views stay for
  the kinds that use them.
- The page is organized around three questions, in priority order: **does it need me?**,
  **what has it been doing?**, **is it healthy?**
- Lead with the agent's *work* (outcomes + produced artifacts), not its configuration
  status.
- Keep the existing charts; relabel Requests → Runs.
- Resource usage is a first-class group, not just charts: context usage (occupancy: run
  tokens vs. the model's window), token consumption, cache savings, cost per run, and
  model/provider. Context usage degrades to a raw token count when the window size is
  unknown.
- Context usage **reuses PR #5402** (Arda, `fe-feat/session-context-info`), which already
  builds the composer's context-budget indicator. Overview uses the **occupancy** measure
  (current fullness / compaction predictor), not the cumulative running sum. The
  context-window denominator comes from that PR's FE `MODEL_CONTEXT_WINDOWS` map (the backend
  registry stores only cost, not window sizes); do not fork the map — lift it to a shared
  location and coordinate with #5402. Follow-up (owned by #5402): source the window from
  litellm `get_model_info().max_input_tokens`.
- The view catalog serves three personas (owner/operator, builder, budget owner) from one
  page via priority ordering, not three separate pages.
- Phase 1 composes only data sources that already exist (tracing, mounts, session
  interactions, triggers). No new backend endpoints in Phase 1.
- Produced artifacts load lazily per outcome row (no object-store fan-out on first paint);
  rows with no files degrade to message output.
- Three distinct zero states (never-run / per-section-empty / first-run-failed), not one
  "no data" panel. New agents get onboarding, not zeroed charts.
- Onboarding reuses agent-home onboarding patterns + `useCreateAgent`; steps self-complete
  from real data and dismiss once the agent has activity.
- This workspace names views/data only; layout, components, and visuals are design's
  (Claude design / Figma).
- No commits during this planning session.

## Open implementation questions

1. **Feature-flag mechanism** — reuse an existing FE flag pattern, or a new one keyed to
   workflow kind? *Recommend:* reuse the existing flag pattern already used for agent
   surfaces; key the default-on by workflow kind.
2. **Outcomes feed depth (N)** — how many recent runs on first paint before "view all"?
   *Recommend:* 10, bounded `LIMIT N`, matching the concept artifact.
3. **Aggregation freshness budget** — is live per-request aggregation acceptable for
   Phase 1, and what staleness is tolerable before Slice 5 becomes required? *Recommend:*
   ship Phase 1 live; set a first-paint latency threshold that triggers Slice 6.
4. **Needs-you resolution in place** — resolve pending interactions directly on Overview
   (embed `ApprovalDock`) or link out to the session? *Recommend:* link out in Phase 1,
   embed later if it proves worth it.
5. **"Run now" ownership** — does Overview trigger a run itself or hand off to the existing
   manual-run path? *Recommend:* reuse the existing manual-trigger path; Overview only
   invokes it.
6. **Context-window map ownership** — where does the shared `MODEL_CONTEXT_WINDOWS` /
   `resolveModelContextWindow` live once both composer and Overview use it, and does that
   lift land in #5402 or here? *Recommend:* lift it to a shared FE location as part of #5402
   (or a small precursor PR) so Overview imports rather than forks; sequence Slice 4 after
   #5402 merges. Confirm with Arda.
7. **Composer vs. Overview measure** — #5402 shows occupancy + running sum side by side to
   pick one live. Overview should not wait on that: it uses occupancy now. *Confirm* the two
   surfaces can settle the measure independently (Overview = occupancy; composer picks its
   own).

## Next action

Share the workspace and the five open questions for agreement. On sign-off, hand the view
catalog (`design.md`) to design for the Figma pass, and start Slice 0 on an implementation
branch (separate from this planning session).
