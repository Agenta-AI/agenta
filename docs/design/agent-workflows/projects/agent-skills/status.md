# Status

Source of truth for this project. Update as work proceeds.

## What this project is

The skills a new Agenta agent carries so a user can chat with it and build their first app: plan
the build, find and wire tools, connect integrations, set triggers and cron jobs, edit its own
instructions, and commit itself. This project owns the skill **content**, the skill **names**, and
the skill **slugs**. It does not own how the skills reach the agent, the build-flow tools, or the
connection round-trip. Those belong to sibling projects (see Coordination).

The design is [`design.md`](./design.md). It is split into Part A (which skills the build flow
needs, reviewable on its own) and Part B (how a skill reaches the agent, named, and contracted).

## Current state — shipped (#4918, authoring skill catalog #4930)

The authoring skill ships in the code-defined static catalog. The build skills ride the build-kit
overlay as `@ag.embed` entries the frontend applies for a run and never commits. Each embed carries
the required `@ag.selector` (`path: parameters.skill`) and the resolved display `name`; the
frontend shows that name, not the raw `__ag__*` slug.

The design rewrite (in `design.md`) did three things the first draft did not. It separated the
product question from the implementation question. It aligned the delivery model with the build-kit
overlay. It cut the settled decisions out of the open-questions list.

## Decisions carried from sibling projects (not relitigated here)

- The agent becomes the app. Self-modification only. (`agent-builder-capabilities`, decision 1.)
- Defaults ride a build-kit overlay, not the committed config. The build skills ride the overlay
  as `@ag.embed` entries the frontend applies for the run, absent from the stored revision.
  (`default-agent-config`.)
- The published default is bare. A skill reaches a run only through the overlay's `@ag.embed`, not
  by force-injection.

## The skill set

Four skills, derived from the build flow, not from the on-disk drafts (which were exploration):

- `agenta-getting-started`: baseline behavior. Exists. Single-source it.
- `build-your-first-app`: the orchestrator. New.
- `discover-and-wire-tools`: find and connect tools. A tested draft. Promote and adapt.
- `set-up-triggers`: cron and event triggers. New.

`create-agenta-agent` stays an external developer skill, not in the build set.

## Open questions (see design.md section 8)

- The skill set count (four, or fold the trigger skill into the orchestrator). Default: four.
- Baseline behavior as a skill or as the always-on preamble. Lean: preamble.
- Whether the overlay carries the full build set or one authoring skill. Coordinate with
  `default-agent-config`.
- How to single-source the getting-started body. Lean: drop the stale file, keep the constant.

## Coordination

- `default-agent-config/` owns the build-kit overlay and the drawer that shows it read-only. This
  project supplies the build set's content, names, and slugs for the overlay to embed and display.
- `agent-builder-capabilities/` owns the trigger, cron, and tool layer. The tools the skills name
  are missing until that project ships them.
- `agent-fe-roundtrip/` owns the connection round-trip. The build skills reference it.

## Links

- Overview of the initiative: [`../agent-builds-an-app/README.md`](../agent-builds-an-app/README.md)
- The build-kit overlay and the drawer that displays it: [`../default-agent-config/design.md`](../default-agent-config/design.md)
- Builder tools and the build-flow steps: [`../agent-builder-capabilities/README.md`](../agent-builder-capabilities/README.md)
- Connection round-trip: [`../agent-fe-roundtrip/design.md`](../agent-fe-roundtrip/design.md)
- The two draft skills:
  [`../tool-discovery/skills/discover-and-wire-tools/SKILL.md`](../tool-discovery/skills/discover-and-wire-tools/SKILL.md),
  [`../agent-creation-skills/skills/create-agenta-agent/SKILL.md`](../agent-creation-skills/skills/create-agenta-agent/SKILL.md)
