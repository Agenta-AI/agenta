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
   ship Phase 1 live; set a first-paint latency threshold that triggers Slice 5.
4. **Needs-you resolution in place** — resolve pending interactions directly on Overview
   (embed `ApprovalDock`) or link out to the session? *Recommend:* link out in Phase 1,
   embed later if it proves worth it.
5. **"Run now" ownership** — does Overview trigger a run itself or hand off to the existing
   manual-run path? *Recommend:* reuse the existing manual-trigger path; Overview only
   invokes it.

## Next action

Share the workspace and the five open questions for agreement. On sign-off, hand the view
catalog (`design.md`) to design for the Figma pass, and start Slice 0 on an implementation
branch (separate from this planning session).
