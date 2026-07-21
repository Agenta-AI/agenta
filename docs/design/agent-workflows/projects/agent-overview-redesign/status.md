# Status

**Last updated:** 2026-07-21 (context-window sourcing updated per PR #5434)

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
- Context usage **reuses the shipped primitive** across a stacked pair: PR #5402 (Arda,
  `fe-feat/session-context-info`) + **PR #5434** (Ashraf,
  `feat/extend-arda's-session-context-work`, stacked on #5402). #5434 is the source of truth.
  Overview uses the **occupancy** measure only (running sum was dropped in #5434). The
  context-window denominator comes from the **model catalog on the harness-capabilities doc**,
  resolved by `contextWindowForModel(capabilities, harness, modelId)` exported from
  `@agenta/entities/workflow` — no hardcoded map, no litellm follow-up. `context_window: null`
  entries (e.g. Claude `default` alias) degrade to a raw token count; filling them is a
  `model_catalog.py` data change, not FE. Match the composer's ambient-meter UI (bar +
  "Context N% used", amber `>= 75%`, red `>= 90%`).
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
6. ~~Context-window map ownership~~ — **RESOLVED by #5434.** No shared map to own: the
   denominator is `contextWindowForModel` in `@agenta/entities/workflow`, sourced from the
   model catalog on the harness-capabilities doc. Overview imports the selector. Slice 4
   depends on #5434 being merged (it is stacked on #5402).
7. ~~Composer vs. Overview measure~~ — **RESOLVED by #5434.** Occupancy is the settled
   measure everywhere; the running sum was dropped. No divergence to reconcile.
8. ~~Overview data path for context usage~~ — **RESOLVED (traced).** (a) The
   harness-capabilities doc is a **global, project-independent** atom
   (`harnessCatalogQueryAtom` ← `GET /workflows/catalog/harnesses/`); Overview reads it with
   `useAtomValue(harnessCapabilitiesAtomFamily(""))`, no `AgentChatSlice` coupling. (b) Per
   run, `model` is on the **LLM child span** (`ag.meta.request.model` /
   `ag.meta.response.model`) while the token total is on the **workflow root** span — pair the
   root with its LLM child. (c) `harness` is **not on the trace**; it's agent config
   (`agent.harness.kind`), stable per agent — read it from the agent like the composer does.
   Call `contextWindowForModel(globalCapabilities, agentHarness, runModel)`; unknowns degrade
   to raw token count. Implementation note captured in `plan.md` Slice 4.

## Next action

Context-usage feasibility (Q6–8) is fully traced and settled; the remaining open items are
the product/rollout calls (Q1–5). Share the workspace and Q1–5 for agreement. On sign-off,
hand the view catalog (`design.md`) to design for the Figma pass, and start Slice 0 on an
implementation branch (separate from this planning session). Slice 4 depends on #5434 (the
context-usage primitive) being merged.
