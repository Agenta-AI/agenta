# Context — Agent Overview redesign

## Problem

The agent Overview page is inherited wholesale from the prompt-management era. Today it
renders `DeploymentOverview`, `VariantsOverview`, `ObservabilityOverview`, and
`LatestEvaluationRunsTable`
(`web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/overview/index.tsx`).

For an agent — an autonomous worker that runs on a trigger, uses tools, produces outputs,
and sometimes needs a human — those views answer the wrong questions. Deployments (dev /
staging / prod), a prompt/variant list, and evaluation runs describe a prompt asset being
promoted through environments. They do not describe an agent's *work*. A person opening an
agent's Overview cannot currently see what it has produced, whether it needs them, or
whether it is healthy.

There is also no considered empty state. A brand-new agent that has never run drops the
user onto the same prompt-era panels rendering zeros, with no path toward first value.

## Scope

- The agent Overview page: what it shows for an **active** agent that has run.
- The **empty / no-data** state for an agent that exists but has never produced activity.
- The **fresh-agent onboarding** path: from "just created" to first successful run and
  first connected trigger.
- A named catalog of agent-workflow views/data the page can draw from, each grounded in a
  real backend source (see `design.md` and `research.md`).

## Out of scope for the first delivery

- New backend endpoints or aggregation jobs. The first delivery composes what already
  exists; anything needing new server-side aggregation is called out as Phase 2 in
  `plan.md`, not built here.
- Cross-agent / workspace-level dashboards. This is the single-agent Overview only.
- Redesigning the playground, the trace/turn inspector, triggers management, or
  connections management — Overview links out to those; it does not replace them.
- Prompt-management surfaces themselves. We are replacing which views the *agent* Overview
  composes, not deleting the deployment/variant components (other workflow kinds still use
  them via `RequireWorkflowKind`).
- Final visual/layout design. That is owned by design (Claude design / Figma). This
  workspace names the views and data; it does not prescribe pixels.

## Product language

- **Run** — a single execution of the agent (one invocation / session). Replaces the
  prompt-era "Request".
- **Outcome** — the human-readable result of a run: what the agent did, plus its state
  (completed / waiting on a human / failed).
- **Artifact** — a file the agent produced during a run, stored in a session mount;
  previewable and downloadable.
- **Trigger** — what started a run: a schedule, an inbound event (Slack / GitHub via
  Composio), or a manual "Run now".
- **Needs-you item** — a human-in-the-loop interaction the agent is blocked on: an
  approval, a question (elicitation), or a client-tool prompt.
- **Connection** — an external integration the agent authenticates to; may be healthy or
  need reconnecting.

## Success criteria

1. Opening an active agent's Overview answers three questions above the fold: **does it
   need me?**, **what has it been doing?**, **is it healthy?**
2. The page shows the agent's actual work — outcomes and produced artifacts — not its
   configuration status.
3. A brand-new agent sees an onboarding experience with a clear first action, never a wall
   of zeroed prompt-era panels.
4. Every view on the page maps to a named, verified backend data source (`design.md`).
5. Non-technical and technical users can both read the page: plain-language outcomes up
   top, drill-down detail (traces, tokens, tool calls) available but not forced.
6. The page surfaces the agent's resource usage in terms each persona can act on — context
   usage (how full the model's context window gets), token consumption, cache savings, and
   cost per run — not just aggregate charts. Each of these ties to a named source in
   `design.md` and maps to a persona in the "Who reads this" section. (Cost/token *totals*
   for agents depend on a backend attribution fix — `research.md` §6, `plan.md` Slice 6; the
   views ship degraded, never a false zero, until it lands.)
