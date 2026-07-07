# Canonical gateway tool rendering in the playground

Design workspace for fixing the playground read path so it renders connected-app
(gateway) tools written in the **canonical persisted shape**, not just the legacy
function-name encoding the UI itself writes.

This is a **frontend-only, read-path** design. No backend or SDK wire changes: both
tool encodings are already equivalent server-side (the SDK compat layer converts
legacy → canonical, and the resolve path enriches description + schema from the live
catalog at run time). Per the standing rule, we normalize on the frontend.

## The one-line symptom

A builder agent authored three Slack tools in the canonical shape
(`{"type":"gateway","provider":"composio","integration":"slack","action":"OPEN_DM",…}`).
The playground showed all three as **"gateway · built-in"** rows under a BUILT-IN
header, each opening a raw JSON editor — instead of "Connected app tool" rows grouped
under a Slack card with a humanized action name.

## Files

| File | What it holds |
| --- | --- |
| [context.md](context.md) | Why this exists, the symptom, goals, non-goals, the standing constraints. |
| [research.md](research.md) | Verified findings: the two encodings, every consumer that keys off the legacy slug, and exactly where the canonical shape falls through. All with file:line citations. |
| [plan.md](plan.md) | The design: one shared shape-detection helper, the read-path changes per consumer, the drill-in decision, the removal/dedupe fix, phasing, and the open questions for Mahmoud. |
| [status.md](status.md) | Current state, decisions taken, and what's blocked on Mahmoud. |

## Live repro

`:8280` dev stack — app `019f3d51-1f93-7452-8133-dff2f0d91385`, revision
`019f3d56-90f3-7870-b1c4-bd67f4313e18` ("Support triage") shows the three misrendered
tools.

## Status at a glance

Design only. Two open questions are parked for Mahmoud (see
[plan.md § Open questions](plan.md#open-questions-for-mahmoud)):

1. Drill-in richness: humanize-only vs. fetch the catalog action detail for a
   description + schema preview.
2. Convergence: should the drawer **start writing** the canonical shape on add and
   retire the legacy encoding over time?
