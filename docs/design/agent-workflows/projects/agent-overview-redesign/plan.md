# Plan — sliced implementation

## Scope now

- Frontend-only composition of data sources that **already exist** (tracing, mounts,
  session interactions, triggers). No new backend endpoints in Phase 1.
- Behind agent-workflow-kind gating (`RequireWorkflowKind`) so prompt-era views are
  untouched for other kinds.
- Feature-flag the new agent Overview so it can ship dark and be switched on per
  environment.
- Anything needing new server-side aggregation is Phase 2 (called out in Slice 4), not
  built in Phase 1.

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
2. Relabel the reused charts (Requests → Runs) and mount them under the band.
- **Exit:** for an agent with runs, the band shows real last-run/next-run/success/cost and
  the charts render; "Run now" triggers a run.

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

1. Reliability: most-used tools (counts + pass/fail from `ag.tool.name` /
   `ag.meta.tool.call.result`) and failures grouped by cause (`ag.exception.type`).
2. Resource usage: token consumption breakdown, cache savings, cost per run/trend, and
   model/provider per run — all from trace token/cost attributes.
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
- **Exit:** a user can see which tools an agent leans on and how reliable they are, how full
  the context window gets per run (occupancy, resolved from the catalog via
  `contextWindowForModel`), and where token/cost is going — with unknown-window runs showing
  a token count rather than a broken percentage.

## Slice 5 — Empty state + onboarding

1. Detect the three zero states (never-run / per-section-empty / first-run-failed) and
   render the right one; never show zeroed prompt-era panels.
2. Build the getting-started checklist (Run it once / Connect / Add a trigger) with
   self-completing steps driven by first-trace / READY-connection / subscription-exists
   detection. Reuse agent-home onboarding patterns + `useCreateAgent`.
3. Dismiss onboarding once the agent has real activity; hand off to active-agent views.
- **Exit:** a brand-new agent sees onboarding with a working first action and steps that
  tick off as data appears; a first failed run shows the failure, not "no data".

## Slice 6 (Phase 2, optional) — Materialized aggregates

Only if Phase 1 render latency proves the per-request aggregation too costly at scale.
1. Index mount file metadata in Postgres at write time (avoid object-store LIST for chips).
2. Materialize run aggregates (success rate, cost, tool pass/fail) at ingest.
3. Serve the band + reliability panels from the materialized store; tolerate labelled
   staleness.
- **Exit:** Overview first paint no longer depends on live fan-out; numbers are within the
  stated staleness budget.

## Flag rollout

Ship Slices 0–5 behind the flag, dogfood, then default on for the agent kind. Slice 6 is a
performance backstop, not a prerequisite.
