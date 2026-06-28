# Status

Source of truth for this project. Update as work proceeds.

## What this project is

The skills a new Agenta agent carries so a user can chat with it and build their first app:
plan the build, find and wire tools, connect integrations, set triggers and cron jobs, edit
its own instructions, and commit itself. This project owns the skill **content** and the skill
**naming**. It does not own which skill is embedded by default, the build-flow tools, or the
connection round-trip. Those belong to sibling projects (see Coordination).

The design doc is [`design.md`](./design.md).

## Current state — 2026-06-28

Research done, first design draft written. Nothing built. This is docs-first. The orchestrator
opens draft PRs after Mahmoud reads the doc. The placeholder skill bodies live inside `design.md`
as design artifacts, not as real skill files.

## Decisions confirmed (carried from sibling projects, not relitigated here)

- The default skill is embedded via `@ag.embed`, present by default, removable. It is not
  force-injected. (Owned by `default-agent-config`, decision 1.)
- Stop force-injecting `agenta-getting-started` through the `pi_agenta` harness
  (`AGENTA_FORCED_SKILLS = []`). Keep the `force_skills` mechanism, the slug constant, the skill
  constant, and the static catalog for a future skill that carries real functionality.

## Findings that need Mahmoud (see design.md "Open questions")

- The getting-started skill body has two copies that have drifted: the SDK constant (canonical,
  served at runtime) and a `services/agent/skills/.../SKILL.md` file (not loaded at runtime).
  Single-source it.
- "Skill" covers two audiences. The embedded build skills speak to the **running agent** and name
  its platform tools. `create-agenta-agent` and `self-host-agenta` speak to an **external
  developer** and use curl. The build use case is the first audience. So `create-agenta-agent`
  should not be embedded as written.
- The skill set, the slug scheme, the embed shape, and how a skill declares its tools.

## Coordination

- `default-agent-config/` owns which skill is embedded and the embed-by-default mechanism. This
  project provides the content for the embedded item.
- `agent-builder-capabilities/` owns the trigger, cron, and tool layer and proposed the build-flow
  skill list. This project takes that list and designs the content. The trigger and create tools
  the skills name are MISSING until that project ships them.
- `agent-fe-roundtrip/` owns the connection round-trip. The build skills reference it; they do not
  redesign it.
- `tool-discovery/` shipped `find_capabilities` and the `discover-and-wire-tools` draft skill.

## Links

- Builder tools and the build-flow skill list:
  [`../agent-builder-capabilities/README.md`](../agent-builder-capabilities/README.md)
- Embed-by-default and the force decision:
  [`../default-agent-config/design.md`](../default-agent-config/design.md)
- Connection round-trip: [`../agent-fe-roundtrip/design.md`](../agent-fe-roundtrip/design.md)
- The two draft skills:
  [`../tool-discovery/skills/discover-and-wire-tools/SKILL.md`](../tool-discovery/skills/discover-and-wire-tools/SKILL.md),
  [`../agent-creation-skills/skills/create-agenta-agent/SKILL.md`](../agent-creation-skills/skills/create-agenta-agent/SKILL.md)
