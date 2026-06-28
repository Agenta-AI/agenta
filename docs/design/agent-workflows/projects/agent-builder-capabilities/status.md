# Status: agent-builder-capabilities

Design only. No code. Grounded in code on `gitbutler/edit` over `big-agents`, 2026-06-28. Paths
are absolute. Part of the `agent-builds-an-app` initiative; read `agent-builds-an-app/README.md`
first.

## What this project owns

The agent-facing tools that let an Agenta agent set up triggers and cron jobs on itself, discover
the events it can react to, and read its own trigger state. Eight platform tools, one of which
(`find_triggers`) needs a small new backend endpoint.

## What it does NOT own

- The skills that teach the build flow. Owned by `agent-skills`. This project ships the tools; that
  project ships the prose that drives them.
- The connection round-trip (pause, connect in the playground, resume). Owned by
  `agent-fe-roundtrip`. The connection branch of the build flow depends on it.
- How defaults reach a new agent. Owned by `default-agent-config`. The builder tools join
  `PLATFORM_OPS` and ride the injected build kit; they are never committed to config.

## Headline finding

The trigger and cron engine already ships as a full backend (`api/oss/src/.../triggers/`): event
subscriptions, cron schedules, deliveries, a Composio event catalog, a worker, and a per-minute
tick. We do not build a scheduler. We add thin platform tools over endpoints that already ship,
plus one new endpoint (`find_triggers`) for keyword event discovery.

## The tool set

`find_triggers` (new backend), `create_schedule`, `create_subscription`, `test_subscription`,
`list_schedules`, `list_subscriptions`, `list_deliveries`, `list_connections`. The three mutating
tools default to approval. Self-targeting binds the destination from run context, the way
`commit_revision` binds the variant id. See `README.md` section 4 for each contract.

## The key UX finding

A live test (`test_subscription`) needs the connection, because it long-polls the provider for a
real event. A dry test does not: the agent runs against the catalog's sample payload. So the
default build order is sample-first. The agent shows the user the agent working before asking for
any authorization. See section 5.1.

## Decisions honored (from the initiative)

1. The agent becomes the app. Self-modification only.
2. Triggers self-target via run-context binding.
3. `find_triggers` is a small new keyword endpoint, `find_capabilities`-shaped.
4. The agent cannot create connections or set secrets; it holds a reference and asks the frontend.
5. Builder tools are injected through the build kit, never committed to config.
6. Mutating tools default to approval.

## Open questions (non-blocking)

See `README.md` section 8: test order (sample-first), same-session vs new-session dry test,
`test_subscription` permission (`ask`), and the test gap (defer the public invoke wrapper).

## State

- [x] Research: triggers/cron engine, catalog, deliveries, connections, `commit_revision` binding.
- [x] Tool set and per-tool contracts (design-interfaces role analysis).
- [x] The agent-driven build flow walked end to end, with the dry-vs-live test finding.
- [x] Inject-not-commit alignment with `default-agent-config`.
- [ ] Orchestrator folds this into the consolidated review.
- [ ] Convert the tool set into per-tool implementation slices.
