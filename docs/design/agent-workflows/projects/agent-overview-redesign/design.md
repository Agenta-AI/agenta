# Design — views, empty state, onboarding

This names the **views/data** the Overview can show and how the three states behave. It
does not prescribe layout, components, or visuals — those are design's to decide (Claude
design / Figma). Every view cites its source from `research.md`.

Concept reference (prior exploration artifact):
https://claude.ai/code/artifact/f2963882-117c-434d-8618-e70222c50683

## The three questions the page answers

Order of priority, top to bottom:

1. **Does it need me?** — needs-you items (blocked runs).
2. **What has it been doing?** — outcomes feed + produced artifacts.
3. **Is it healthy?** — status, success rate, cost/latency/token trends, tool reliability,
   connection health.

## View catalog (active agent)

Each entry: **view** — one-line purpose — *source* (from `research.md`).

### Status & health band
- **Agent status** — on / idle, is it currently running — *tracing (recent trace state)*.
- **Last run / next run** — when it last ran, when it runs next — *tracing (last trace) +
  triggers (cron)*.
- **Success rate** — share of recent runs that completed — *tracing aggregate*.
- **Avg cost / run** — typical spend per run — *tracing aggregate (`gen_ai.usage.cost`)*.
- **Run now** — manual trigger — *triggers (manual)*.

### Needs-you
- **Pending human items** — count + list of approvals / questions / client-tool prompts the
  agent is blocked on, each linking to where it's answered — *session interactions,
  `status = pending`*.

### What your agent produced (outcomes feed)
Per recent run, one row that adapts to what the run produced:
- **Outcome summary** — plain-language "what it did" — *`ag.meta.final_result`*.
- **Run state** — completed / waiting on a human / failed — *trace status + interactions*.
- **Failure reason** — shown inline when failed — *`ag.exception.message`*.
- **Produced artifacts** — file chips: name, type (extension), size, preview, download —
  *session mounts (`MountFile` + `MountCredentials`)*.
- **Message output** — text snippet, for agents that reply instead of writing files —
  *`ag.data.outputs.completion`* (row degrades to this when no mount files).
- **Run meta** — trigger source · duration · cost · tools-used count — *tracing +
  triggers*.

### Metrics (charts) — from the analytics gateway
- **Runs** (was "Requests"), **Latency**, **Cost**, **Tokens** over time — *`POST
  /analytics/query` with explicit `specs` (research.md §5–6), not the 5% the current charts
  use.* The endpoint aggregates **root spans only** (one row per run), which is exactly
  right for run-level charts.
- **Latency is the free upgrade**: request percentiles + histogram, not just the avg the
  current chart shows (one 38 s run skews the mean). Show p50/p90/p95, keep avg as a
  secondary stat.
- **Cost & Tokens are blocked on attribution** (research.md §6): agent runs don't populate
  `costs.cumulative.total` (cost is derived only on LLM-type child spans; `gen_ai.usage.cost`
  is unmapped) and only populate `tokens.cumulative.total` via a best-effort bridge. This is
  why the live dashboard shows `-`. Depends on the backend fix (plan.md Slice 4 note +
  Slice 6); until then, degrade to the run-level token count the agent reports, not a zero.

### Reliability (drill-down, not forced)
- **Most-used tools** — which tools it calls, counts, pass/fail flag — *`ag.tool.name` /
  `ag.meta.tool.call.result`, on **tool child spans** → **not** servable by the root-only
  `/analytics/query`; read per-run via bounded trace reads, or add a backend roll-up
  (research.md §3b/§6). Live composer equivalent (same style as the context-budget indicator,
  no new fetch): tool message-parts (`part.type` `tool-*`/`dynamic-tool`, name via
  `partToolName`, pass/fail via `part.state`).*
- **Where it's failing** — failures grouped by cause — *`ag.exception.type`; child-span data,
  same root-only caveat as tools.*

### Resource usage & cost (the "what is it consuming" group)
- **Context usage** — how full the model's context window gets per run (occupancy: run
  tokens vs. the model's window), so a user can see runs approaching compaction/truncation —
  *reuses the shipped primitive from PR #5402 + #5434. Occupancy per run =
  `ag.metrics.unit.tokens.total` / `gen_ai.usage.total_tokens` from the trace store; the
  denominator per run = `contextWindowForModel(capabilities, agentHarness, runModel)`
  (`@agenta/entities/workflow`), sourced from the model catalog — not a hardcoded map.
  Inputs (traced, `research.md` §1 / Q8): `capabilities` from the global harness-catalog
  atom; `agentHarness` from agent config (`agent.harness.kind`), not the trace; `runModel`
  from the run's LLM child span. Window `null` → show raw token count, no bar/percent.* Use the
  **occupancy** measure (running sum was dropped in #5434). Match the composer's ambient
  meter: fill bar + "Context N% used", amber `>= 75%`, red `>= 90%`. See `research.md` §1 for
  the full reconciliation.
- **Token consumption** — breakdown of prompt / completion / reasoning / cached tokens per
  run and over time — *`ag.metrics.unit.tokens.{prompt,completion,reasoning,cache_read,cache_creation,cached}`.
  Run-level totals + distributions (mean/percentiles/histogram) come from the analytics
  gateway (research.md §6) once agent tokens are attributed to the root; per-token-type
  breakdown that isn't on the root reads per-run from the trace.*
- **Cache savings** — how much prompt caching is saving (cache-read share, cost avoided) —
  *`ag.metrics.unit.tokens.cache_read` / `gen_ai.usage.cache_read.input_tokens`*.
- **Cost** — cost per run, avg per run, and trend; optionally cost per tool —
  *`gen_ai.usage.cost`. **Attribution gap (research.md §6):** this attribute is dropped at
  ingest (no semconv mapping) and cost is derived only on LLM-type child spans, so agent
  runs currently have no root cost — the live dashboard shows `-`. Needs the backend fix
  before this view has data.*
- **Model & provider** — which model/provider each run used (agents can switch models) —
  *`ag.meta.model_name` / `ag.meta.provider`; on LLM child spans, so **not** the root-only
  analytics endpoint — read per-run from the trace (same as context usage's `runModel`).*

## Who reads this (persona → what they use)

The catalog covers three readers without three pages — each view already maps to one of
them; the layout just orders by priority:

- **Owner / operator** (often non-technical): *does it need me, is it working, what's it
  costing?* → needs-you, outcomes feed, status band, success rate, cost.
- **Builder / developer**: *why did it fail, is it efficient, am I near the context limit?*
  → context usage, token consumption, tool reliability, failures, trace drill-down.
- **Budget owner / stakeholder**: *what's the spend and is caching helping?* → cost trend,
  cost per run, cache savings.

Plain-language work stays on top for the operator; usage/efficiency detail sits lower and
behind clicks for the builder and budget reader.

### Connections & triggers
- **Connections** — external integrations and whether any need reconnecting (Reconnect
  action) — *`TriggerConnectionStatus` READY / NEEDS_AUTH / NEEDS_INPUT*.
- **Triggers** — active schedules / event subscriptions and next scheduled run —
  *`TriggerSubscription` + cron*.

## Empty / no-data state (agent exists, never produced activity)

Not one panel. Distinguish and handle:
- **New agent, never run** — onboarding (below), not zeroed charts.
- **Per-section empty** — a section with no data yet shows an inviting empty state naming
  what will appear there and how to make it appear, not a blank box or a zero.
- **First run failed** — treat as activity: show the failure and the reason, plus a "try
  again / open trace" path. Do not show it as "no data".

Rules:
- Never render prompt-era panels (deployments / variants / evaluations) for an agent, empty
  or not.
- Never show a wall of zero charts as the primary content for a new agent.
- Every empty section states the one action that fills it.

## Fresh-agent onboarding (just created → first value)

Replace the empty Overview body with a getting-started experience. The milestones map to
real capabilities and each is individually detectable, so the checklist self-completes:

1. **Run it once** — a "Run now" that produces the first outcome. *Done when the first
   trace exists.*
2. **Connect an integration** — if the agent's tools/triggers need one. *Done when a
   `TriggerConnectionStatus` is READY.*
3. **Add a trigger** — a schedule or event subscription so it runs on its own. *Done when a
   `TriggerSubscription` exists.*

Behavior:
- Show progress (e.g. 1 of 3), mark steps done as the underlying data appears, and dismiss
  the onboarding once the agent has real activity — after which the active-agent views take
  over.
- Reuse the existing agent-home onboarding / composer patterns and `useCreateAgent` flow
  rather than inventing a parallel onboarding.
- Keep it to the few steps that lead to first value; do not gate the page behind it (a user
  can always ignore the checklist and use "Run now").

## Cross-cutting principles

- Lead with work, not configuration. Config status (connections, triggers) is supporting,
  not the headline.
- Plain language on top, drill-down underneath. Non-technical readers get outcomes;
  technical readers can open traces / token detail / tool calls.
- Calm and uncrowded. Prioritize the three questions; everything else is secondary or
  behind a click.
- Reuse Agenta's existing design system and the already-built agent surfaces
  (`ApprovalDock`, `TurnInspector`, agent-home onboarding).
