# Status: agent-builder-capabilities

Design only. No code, no PR. Grounded in code on branch `gitbutler/edit` (over `big-agents`),
2026-06-28. File paths are absolute.

## What this project owns

The tools and skills an Agenta agent needs so it can build an app end to end by chatting with
a user: wire tools and connections, edit its own instructions, set up a trigger or a cron job,
and commit the result. This is the "agent builds an agent" use case.

## What it does NOT own

- Which defaults get loaded into a NEW agent at create time. That is
  `projects/default-agent-config/` (read it, do not edit it).
- The interactive frontend round-trip (config-change approval, connection-request client
  tool, OAuth redirect pause/resume). That is the separate FE round-trip design. This doc
  names the dependency and defers the mechanism.

## State

- [x] Research: triggers/cron, skills, config shape, existing endpoints, sibling docs.
- [x] Round 1 draft: walkthrough, missing tools, missing skills, FE split, open questions.
- [x] Round 2: Mahmoud's four decisions locked in; agent-driven trigger UX walked end to end.
- [ ] Orchestrator folds this into the consolidated draft PR for review.
- [ ] Convert decisions into per-tool and per-skill implementation slices.

## Headline finding

Triggers and cron already exist as a full backend subsystem (`api/oss/src/.../triggers/`):
event subscriptions, cron schedules, deliveries, a Composio catalog, a worker, and a cron
tick. We do not build a scheduler. We expose thin platform tools over endpoints that already
ship, plus the skills that teach the build flow. The one new backend piece is `find_triggers`
(a keyword event-discovery endpoint).

## Decisions locked (round 2)

1. **Self-modification only.** The agent becomes the app; no create-other-workflow tools.
2. **Triggers self-target** via run-context binding (like `commit_revision`).
3. **`find_triggers`** = small new keyword-search backend, `find_capabilities`-shaped.
4. **Agent cannot create connections or set secrets.** It requests a connection through the FE
   round-trip; secrets stay FE-only.

## Tools to add (all thin platform-op wrappers except find_triggers)

`create_schedule`, `create_subscription` (self-targeted, approval-gated), `list_schedules`,
`list_subscriptions`, `list_deliveries`, `list_connections`, `test_subscription`, and the new
`find_triggers` endpoint + tool.

## Skills to add

`build-your-first-app` (orchestrator), `set-up-triggers`; promote the `discover-and-wire-tools`
and `create-agenta-agent` drafts to `__ag__*` platform skills (update to the renamed config
fields first).

## Smaller questions still open

See `README.md` section 7: test order (sample-first), same-session vs new-session dry test,
`test_subscription` permission, `find_triggers` endpoint vs skill-only, and the test gap.
