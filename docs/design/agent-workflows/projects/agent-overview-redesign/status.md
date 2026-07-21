# Status

**Last updated:** 2026-07-21 (analytics endpoint audited: gateway capability, root-only
scope, and the agent cost/token attribution gap — research.md §5–6; cost roll-up path traced
— the fix is a one-line semconv row, Q9. Never-run empty state settled: guidance to the
Playground — not a run action, checklist, or template gallery.)

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
- Keep the charts, but drive them from the **analytics gateway** (`POST /analytics/query`)
  with **explicit `specs`** — the current dashboard uses ~5% of the endpoint. Relabel
  Requests → Runs and upgrade Latency from avg-only to **percentiles + histogram** (research.md
  §5–6).
- **The analytics endpoint is the gateway for run-level aggregates, and it is root-only**
  (`WHERE parent_id IS NULL`, one row per run). It serves numeric distributions + root-stamped
  categoricals. It does **not** serve child-span breakdowns (per-tool usage/pass-fail, per-LLM
  model mix, failures by the failing child's cause) — those stay on per-run trace reads until a
  backend roll-up (Slice 6).
- **Agent cost/token attribution is a real backend gap** (why the live dashboard shows Cost
  and Tokens as `-`): `gen_ai.usage.cost` is unmapped at ingest and cost is derived only on
  LLM-type child spans; agent tokens ride a best-effort `record_usage` bridge. The
  Cost/Token views **degrade gracefully** (reported token count, cost hidden — never a false
  zero) until the Slice 6 fix lands. Full detail: research.md §6.
- Resource usage is a first-class group, not just charts: context usage (occupancy: run
  tokens vs. the model's window), token consumption, cache savings, cost per run, and
  model/provider. Context usage degrades to a raw token count when the window size is
  unknown; cost/token totals depend on the attribution fix above.
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
  interactions, triggers) and reuses the existing `/analytics/query` endpoint. No new backend
  *endpoints* in Phase 1 — but one backend *ingest fix* (agent cost/token attribution) is a
  surfaced dependency for the Cost/Token views, tracked in Slice 6 with graceful degradation
  in the meantime.
- Produced artifacts load lazily per outcome row (no object-store fan-out on first paint);
  rows with no files degrade to message output.
- Three distinct zero states (never-run / per-section-empty / first-run-failed), not one
  "no data" panel. New agents get plain-language guidance, not zeroed charts.
- **Never-run Overview = guidance, not a launcher.** The Overview reports work; it does not
  run the agent or pick its template. A never-run agent gets a guidance state — a frame of
  what the page tracks + a single pointer to the Playground + a preview of what will appear —
  not a run action, checklist, or template gallery. It self-fills on the first trace; nothing
  to dismiss. (Supersedes the earlier run-CTA and 3-step-checklist ideas.)
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
5. **Manual "Run now" on an *active* agent** — the never-run empty state points to the
   Playground (Overview reports, it doesn't launch). Does the active health band still keep a
   manual "Run now" (re-run a working agent on demand), or defer to the Playground/triggers
   for consistency? *Recommend:* keep a manual re-run on the active band, but if it stays,
   reuse the existing manual-trigger path — Overview only invokes it, never owns running.
   Resolve before Slice 1 finalizes the band.
9. **Agent cost/token attribution — fix at ingest or on the FE?** (research.md §6, Slice 6
   item 1.) **Traced — the cost fix is one line.** The `unit.* → incremental.* → cumulative.*`
   pipe already exists and already handles costs (`span_data_builders.py:171-179`), and
   `record_usage` already stamps `gen_ai.usage.cost` on the agent root — the only gap is a
   missing semconv row. Option (a): add `("gen_ai.usage.cost", "ag.metrics.unit.costs.total")`
   to semconv; cost then flows to `costs.cumulative.total` (the default spec) with no
   price-table or span-type work. Covers cost-reporting harnesses; token-only harnesses still
   need price-table derivation. Watch the double-count risk if the harness batch is later
   bridged, and note it's ingest-time only (not retroactive). Option (b): FE reads reported
   per-run usage from the trace and aggregates client-side. *Recommend:* (a) — now known to be
   cheap and the correct source of truth; (b) is a stopgap. **Tokens are a separate issue** —
   their pipe is complete, so a `-` means `record_usage` isn't firing, not a mapping gap;
   diagnose with a live root-span attribute dump. Ship Cost/Token views degraded until (a)
   lands. Needs a backend owner; the mapping itself is a one-line PR.
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

Context-usage feasibility (Q6–8) is fully traced and settled. The analytics endpoint is now
audited (research.md §5–6): it is the gateway for run-level charts/distributions, it is
root-only, and agent cost/token attribution is a backend gap (new Q9). Remaining open items
are the product/rollout calls (Q1–5) plus the backend-owned attribution decision (Q9). Share
the workspace and Q1–5 + Q9 for agreement. On sign-off, hand the view catalog (`design.md`)
to design for the Figma pass, and start Slice 0 on an implementation branch (separate from
this planning session). Slice 4 depends on #5434 (the context-usage primitive) being merged;
its Cost/Token data depends on Q9/Slice 6.
