# Plan — sliced implementation

## Scope now

- Frontend-only composition of data sources that **already exist** (tracing, mounts,
  session interactions, triggers). No new backend endpoints in Phase 1.
- Behind agent-workflow-kind gating (`RequireWorkflowKind`) so prompt-era views are
  untouched for other kinds.
- Feature-flag the new agent Overview so it can ship dark and be switched on per
  environment.
- Anything needing new server-side aggregation is Phase 2 (flagged where it bites in Slice 4,
  built in Slice 6), not built in Phase 1.
- **One backend dependency is surfaced, not a new endpoint:** agent cost/token
  **attribution** at ingest (research.md §6). The existing `/analytics/query` endpoint is
  reused as-is (it is the "gateway" — Slice 1/4); but agent runs don't populate the root
  cost/token paths it reads, so the Cost/Token views degrade until that ingest fix lands
  (Slice 4 note + Slice 6). This does not change "no new endpoints in Phase 1."

Each slice leaves the tree working and testable.

## Slice 0 — Pin the current page and gate

1. Add an agent-kind branch in the Overview page entry so agent workflows render a new
   `AgentOverview` container while all other kinds keep the current
   Deployment/Variants/Observability/Evaluation composition.
2. Ship `AgentOverview` as a stub behind a feature flag (default off) that renders the
   existing charts only, to prove the gate without regressing anyone.
- **Exit:** an agent workflow with the flag off shows today's page; with the flag on shows
  the stub with charts. No other workflow kind changes.

## Slice 1 — Status & health band + Runs charts

1. Build the status/health band: agent status, last run, next run (cron), success rate,
   avg cost, Run now — all from existing tracing aggregates + trigger schedule.
2. Drive the charts from the analytics gateway (`POST /analytics/query`) with **explicit
   `specs`**, not the defaults (research.md §5–6). Relabel Requests → Runs. Add **latency
   percentiles** (p50/p90/p95 + histogram) — a near-free upgrade over the current avg-only
   chart, which one slow run skews. Cost/Tokens use the same endpoint but are gated on the
   attribution fix (Slice 4 note); until then degrade to the reported token count, never a
   zero.
- **Exit:** for an agent with runs, the band shows real last-run/next-run/success/cost and
  the charts render (latency shows a distribution, not just avg); "Run now" triggers a run.

## Slice 2 — Outcomes feed (with adaptive artifact/message rows)

1. Fetch the N most recent runs (bounded `LIMIT N`, no fan-out) and render one outcome row
   each: summary (`ag.meta.final_result`), state, failure reason, run meta.
2. Lazy-load produced artifacts per row on expand: list mount files, render file chips
   (name / ext / size), wire preview + download through `MountCredentials`.
3. Degrade a row with no mount files to its message output
   (`ag.data.outputs.completion`).
- **Exit:** recent runs show plain-language outcomes; a run that wrote files shows
  previewable/downloadable chips; a text-only run shows its message; a failed run shows its
  reason. No object-store LIST happens until a row is expanded.

## Slice 3 — Needs-you, connections, triggers

1. Needs-you: count + list of `pending` session interactions, each linking to where it's
   answered (reuse `ApprovalDock` where possible).
2. Connections: list with health from `TriggerConnectionStatus`; Reconnect for NEEDS_AUTH.
3. Triggers: active schedules / subscriptions + next scheduled run.
- **Exit:** a blocked agent shows its pending items and they resolve from Overview; a
  connection needing reauth shows Reconnect; schedules show next run.

## Slice 4 — Reliability & resource-usage panels

Two data paths here — keep them separate (research.md §6). `/analytics/query` aggregates
**root spans only** (`WHERE parent_id IS NULL`), so it serves run-level *numeric
distributions* but cannot see child-span categoricals.

1. Reliability (**child-span data → per-run trace reads, not the gateway**): most-used tools
   (counts + pass/fail from `ag.tool.name` / `ag.meta.tool.call.result`, on tool spans) and
   failures grouped by cause (`ag.exception.type`). Read from bounded `LIMIT N` recent-run
   traces; a backend roll-up onto the root (Slice 6) would let the gateway serve these later.
2. Resource usage:
   - **Run-level numeric distributions via the gateway** (`/analytics/query` specs):
     token totals and cost per run — mean/percentiles/histogram/trend — **once agent
     cost/token attribution is fixed** (research.md §6; cost is dropped at ingest and
     derived only on LLM-type spans, tokens ride a best-effort bridge). Until then this view
     degrades to the reported token count and hides cost, never showing a false zero.
   - **Cache savings** and **per-token-type breakdown / model & provider per run** are
     child-span or reported-usage data → read per-run from the trace (same path as context
     usage's `runModel`), not the gateway.
3. Context usage: reuse the shipped primitive (PR #5402 + #5434). Denominator per run =
   `contextWindowForModel(capabilities, agentHarness, runModel)` — already exported from
   `@agenta/entities/workflow`, sourced from the model catalog on the harness catalog (no map
   to lift, no fork). Wire the three inputs from their real locations (traced, question #8):
   `capabilities` from the global `harnessCapabilitiesAtomFamily("")`; `agentHarness` from the
   agent config (`agent.harness.kind`) — NOT the trace; `runModel` from the run's LLM child
   span (`ag.meta.request.model` / `ag.meta.response.model`), while the token total comes off
   the workflow root span — so read root + LLM child together per run. Occupancy = latest
   turn's total tokens vs. that window; degrade to a raw token count when the window is
   `null`. Match the composer's ambient-meter styling (bar + "N% used", amber `>= 75%`,
   red `>= 90%`).
- **Exit:** a user can see which tools an agent leans on and how reliable they are (from
  per-run traces), how full the context window gets per run (occupancy, resolved from the
  catalog via `contextWindowForModel`), and where tokens are going — with unknown-window runs
  showing a token count rather than a broken percentage. **Cost is shown only where
  attributed** (LLM-app runs today; agent runs after the Slice 6 ingest fix), never a false
  zero.

## Slice 5 — Empty states + never-run guidance

1. Detect the three zero states (never-run / per-section-empty / first-run-failed) and
   render the right one; never show zeroed prompt-era panels.
2. Never-run agent → the guidance state (structure): a frame of what the page tracks + why
   it's empty, one pointer to the Playground (reuse the existing Playground route), and a
   faint preview of the sections that will appear. No run action, no checklist, no template
   gallery, nothing to dismiss.
3. Empty-vs-active keys on the first-trace signal (the same one the active views use); once a
   run exists the active-agent views render. Keep connections/triggers out of the empty state.
- **Exit:** a brand-new agent sees guidance to the Playground plus a preview of what will
  appear; once it has run, the same page shows its work; a first failed run shows the failure,
  not "no data".

## Slice 6 (Phase 2) — Backend attribution + materialized aggregates

Two independent backend items. The first is a **correctness dependency** (agent cost/token
data), not just a performance backstop; the rest are performance/scale, done only if Phase 1
render latency proves the per-request aggregation too costly.

1. **Agent cost/token attribution** (unblocks the Cost/Token views, research.md §6). Pick
   one: (a) map `gen_ai.usage.cost` in semconv and treat agent/workflow root spans as
   cost-bearing (or bridge the harness's separate OTLP batch so its LLM spans roll onto the
   root); or (b) accept the FE reading the agent's reported per-run usage from the trace and
   aggregating client-side. Either makes the root cost/token paths the gateway reads
   non-empty for agents.
2. **Roll child-span categoricals onto the root** (or expose a child-focused analytics
   aggregation) so most-used-tools / failures-by-cause / model-mix can move from per-run
   trace reads to the gateway — removes the reliability panels' fan-out.
3. Index mount file metadata in Postgres at write time (avoid object-store LIST for chips).
4. Materialize run aggregates (success rate, cost, tool pass/fail) at ingest; serve the band
   + reliability panels from the materialized store, tolerating labelled staleness.
- **Exit:** agent Cost/Token views show real numbers; reliability/first-paint no longer
  depend on live per-run fan-out; numbers are within the stated staleness budget.

## Flag rollout

Ship Slices 0–5 behind the flag, dogfood, then default on for the agent kind. Slice 6 is
mostly a performance backstop, **except item 1 (agent cost/token attribution)**, which gates
the Cost/Token views specifically — those degrade gracefully until it lands, so it does not
block the flag, only those two views' data.
