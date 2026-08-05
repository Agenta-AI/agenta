# Build-kit overlay delivery — make the playground build kit reliably visible on every agent

**Status:** DESIGN DRAFT (see [status.md](./status.md))
**Owner:** onboarding / agent-workflows
**Created:** 2026-07-07

## The one-paragraph problem

The playground's Advanced section shows a read-only "Playground build kit" overlay on
agent configs — 16 platform ops, the read/bash builtins, `request_connection`, the
build-an-agent skill, and the sandbox permissions the assistant uses to build and revise
an agent. It is **missing** on agents created through the new template-builder /
playground-native onboarding flow, both before the agent is committed AND after. Today
the overlay is delivered by riding on a single application-fetch response
(`GET /simple/applications/{id}` → `additional_context`) and resolved on the frontend
through a fragile three-hop atom chain keyed on the open revision. The overlay content,
however, is a **static function of the platform catalog** — `build_agent_template_overlay()`
takes no application argument. Coupling it to a per-application fetch is the root of this
whole bug class.

## The fix in three sentences

Make the build kit the reserved static workflow **`__ag__build_kit`** in the existing
`StaticWorkflowCatalog` — a **plain agent config** whose `parameters.agent` carries the
tools, skills, and sandbox elevation — and have the frontend resolve it **by slug** through
the workflow retrieve path that already serves the other `__ag__*` constants, **once per
project/session**. Merge it **client-side onto any agent-typed entity** open in the
playground — ephemeral `local-*` drafts, onboarding-committed agents, classic template
apps, and SDK-created apps alike — gated only by the target entity's type
(`flags.is_agent`), never by a workflow/application id. Retire the per-application
`additional_context` attachment once the frontend migrates.

**Decision: Option F (Mahmoud, 2026-07-07).** No new endpoint and no new id — one namespace
and one mental model shared with the other static constants, embed-ability left open as a
future product choice. This supersedes the earlier "dedicated route" (A) and "rider on the
catalog-template response" (B) doors. See
[context.md](./context.md#delivery-door--decision-option-f-reserved-static-workflow) and
[status.md](./status.md).

## Why this matters now (the gate)

This fix **gates the flags-default-on re-flip**. Mahmoud's requirement is that the new
agent experience ship default-on with zero env configuration; the parked default work
lives on the PR #5121 lane. We should not flip the new onboarding on by default while its
signature affordance (the build kit) is invisible on the agents it creates. See
[context.md](./context.md#the-gate-flags-default-on).

## File index

| File | What's in it |
|------|--------------|
| [context.md](./context.md) | Problem statement, background, the flag-default gate, constraints, the Option-F decision (with A–E for the record), glossary |
| [research.md](./research.md) | Root-cause with live evidence, the old atom chain, the disproven "missing application row" theory, the Option-F verify-item findings, file/line map |
| [plan.md](./plan.md) | Phased implementation sized for narrow subagents (catalog entry, FE slug retrieve, retire the rider, tests, live QA) |
| [status.md](./status.md) | The Option-F decision, the parked lane's fate, root-cause verdict, what needs Mahmoud's confirmation, next steps |

## TL;DR of the root cause

The server is healthy for **every** creation path. Live-verified: an agent created the
onboarding way (`POST /workflows/` + variant + two commits) resolves as a full simple
application, and `GET /simple/applications/{workflow_id}` returns the identical 16-tool
overlay that the classic path returns. **The "onboarding commits a bare workflow with no
application row" theory is disproven.** The gap is entirely in the delivery/resolution
coupling on the frontend: the overlay is only reachable through
`revisionId → workflow_id → applicationId → app fetch`, and that chain short-circuits for
ephemeral drafts (no `workflow_id`) and is identity/timing-fragile for the in-place
onboarding swap. Because the overlay is catalog-static, the entire chain is unnecessary.
