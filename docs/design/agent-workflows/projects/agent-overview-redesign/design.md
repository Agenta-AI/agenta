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

### Metrics (keep the charts)
- **Runs** (was "Requests"), **Avg latency**, **Cost**, **Tokens** over time —
  *`ObservabilityOverview` aggregates, relabelled*.

### Reliability & efficiency (drill-down, not forced)
- **Most-used tools** — which tools it calls, counts, pass/fail flag — *`ag.tool.name` /
  `ag.meta.tool.call.result`*.
- **Where it's failing** — failures grouped by cause — *`ag.exception.type`*.
- **Token & cache efficiency** — token breakdown and cache savings — *`ag.metrics.unit.tokens.*`*.

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
