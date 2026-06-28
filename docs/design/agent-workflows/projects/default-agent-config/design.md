# Design: default agent config (platform tools and the default skill)

Status: draft for Mahmoud's review. Grounded in code on `gitbutler/edit` over
`big-agents`, 2026-06-28. See `research.md` for the full code trace.

## Problem and goal

When a user creates a new agent, the config arrives almost empty: no tools, no skills. We
want a new agent to start useful. The config should arrive pre-loaded with:

1. All the platform tools. Today that is the three core ops (`find_capabilities`,
   `query_workflows`, `commit_revision`). Once the builder project ships its tools, the default
   grows to carry every platform op the catalog holds: the three core ops plus the eight trigger
   and cron ops (`create_schedule`, `create_subscription`, `list_schedules`,
   `list_subscriptions`, `list_deliveries`, `list_connections`, `test_subscription`,
   `find_triggers`). Several of these are approval-gated. They all ship with their catalog
   default permissions, and the user can edit those permissions. This is intended (see decision 3
   and the risks section).
2. The default Agenta skill (`agenta-getting-started`), referenced by embed.

Workflow (reference) tools are user-added and stay exactly as they are. This design does
not touch them.

The defaults are opt-out. The user can remove any default item. Disable-but-keep is a
later addition, not part of this design (see decision 2).

Out of scope: the debug-mode UX issue where defaults are not shown, and any "add platform
tool" picker. We cover making the defaults present and removable, nothing more on UX.

## What ships today

- One builder is the source of the default agent config:
  `build_agent_v0_default(...)` at
  `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/utils/types.py:1399`. It returns
  `tools: []` and, only when asked, one skill embed. It already accepts `skill_slug=` and
  `include_sandbox_permission=`.
- Platform tools are catalog ops. Three exist today (`find_capabilities`, `query_workflows`,
  `commit_revision`); the builder project adds eight more. A config entry is just
  `{"type": "platform", "op": "<name>"}`. There is no wildcard.
- The default skill is one placeholder, `agenta-getting-started`, served read-only from
  code by the static catalog under the reserved slug `__ag__getting_started_with_agenta`.
- Today the skill reaches a run two ways, and neither is what we want:
  - The service `/inspect` schema default embeds it (passes `skill_slug`), but that path
    does not reach the new-agent draft (see the injection-point finding below).
  - The `pi_agenta` harness force-injects it via `AGENTA_FORCED_SKILLS`. Forced means the
    user can never remove it. That is the opposite of opt-out.
- No `enabled`/`disabled` flag exists on tools or skills. Items are present or absent.

## The injection point (the finding)

Mahmoud's instinct was right: the defaults must reach the temporary playground (the draft
of a not-yet-created agent). I traced exactly where that draft gets its values.

When the user creates a new agent, the frontend builds a local draft in
`createEphemeralAppFromTemplate`
(`/home/mahmoud/code/agenta/web/packages/agenta-entities/src/workflow/state/appUtils.ts:118`).
It fills the draft from two different sources:

- The editable parameter values come from the catalog template, `template.data.parameters`
  (appUtils.ts:189). This is what the user sees and edits.
- The schemas (the shape used to render controls) come from `/inspect`, best effort
  (appUtils.ts:171-185). Only the schema shape. Not the parameter values.

So the draft's actual values come from the catalog, not from `/inspect`.

The catalog builds `template.data.parameters` by reading the `default` off the parameters
schema (`_extract_schema_parameter_defaults` in
`/home/mahmoud/code/agenta/api/oss/src/resources/workflows/catalog.py:27`). That schema
comes from the SDK interface registry, not from the service. The agent interface there is
bare:

```
# interfaces.py:537
default=build_agent_v0_default()   # no skill, no tools
```

The comment on that line is explicit: "The minimal builtin default: no platform skill, no
sandbox_permission. The agent service adds both via the same builder (see schemas.py)."

So there are two separate defaults for the agent:

- The SDK interface default (bare). Feeds the catalog, which feeds the new-agent draft.
- The service `/inspect` default (enriched with the skill embed and the sandbox boundary).
  Feeds `/inspect`, which the draft reads for schemas only, never for values.

That is the gap. The service enriches the default the draft never reads, and the draft
reads the bare default the SDK interface declares. The skill embed the service adds, and
the platform tools we want to add, do not reach a new agent.

### Why the skill embed did not reach the draft

The getting-started skill is already embedded in the default, but only on the service
`/inspect` default. The catalog template, which is the surface the draft actually reads,
still uses the bare builder. So the embed sits on a default no one reads for values. The
fix is not to make the draft read `/inspect`. The fix is to put the enriched default (the
platform tools plus the skill embed) into the catalog template path. Then it reaches the
draft, and `/inspect` is not used for values at all.

## The four decisions (locked by Mahmoud)

1. The default skill is embedded, not forced. The default config carries an `@ag.embed`
   of `__ag__getting_started_with_agenta`, present by default and removable. Stop
   force-injecting it through the `pi_agenta` harness. Keep the `force_skills` mechanism in
   the code for a future skill that carries real functionality.
2. Delete-only for v1. No `is_active` flag now. Disable-but-keep comes later.
3. Platform tools are a frozen, explicit list. Read all ops from the catalog at build
   time, then store the result as a concrete list. No wildcard, no run-time resolution of
   "all".
4. The defaults must surface where the new-agent draft reads them, so the temporary
   playground shows them.

## Proposed change set, by layer

The fix points the catalog template at the enriched default. The catalog is the surface
the draft reads. Today it sources the agent default from the bare SDK builtin interface. It
will instead source the enriched default: the same builder output the service already uses,
plus the frozen platform-tools list. The SDK builtin interface stays bare. `/inspect` is
not used for the draft's values.

1. SDK builder. Extend `build_agent_v0_default` with one option that adds the platform
   tools, sourced from `PLATFORM_OPS.keys()` at build time and frozen into a concrete list
   of `{"type": "platform", "op": "<name>"}` entries (decision 3). The skill embed already
   has `skill_slug=`. The builder gains the ability to emit these; its own no-arg default
   does not change, so the bare builtin stays bare. File:
   `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/utils/types.py:1399`.

2. Catalog template (the load-bearing fix for the draft). Source the agent template entry's
   parameter default from the enriched default
   (`build_agent_v0_default(skill_slug=__ag__getting_started_with_agenta,
   include_sandbox_permission=True, include_platform_tools=True)`) rather than the bare
   builtin the interface registry carries. The existing extraction and normalization
   pipeline then moves the object default into `data.parameters` as it already does, so
   `template.data.parameters.agent` carries the platform tools and the skill embed. This is
   the larger interface-registry wiring change: the catalog stops inheriting the bare
   interface default for the agent entry. File:
   `/home/mahmoud/code/agenta/api/oss/src/resources/workflows/catalog.py` (the
   `_enrich_entry` / `_build_template_data` path for the agent entry). The enriched default
   imports cleanly from the SDK (`build_agent_v0_default`, `PLATFORM_OPS`, and the slug
   constant `GETTING_STARTED_WITH_AGENTA_SLUG`), so no new shared module is needed.

3. Service `/inspect`. Already passes `skill_slug` and `include_sandbox_permission`. Add the
   platform-tools option so its default and the catalog template share one enriched value
   and cannot drift. This keeps `/inspect` consistent and keeps the runtime fallback (which
   uses the service default) consistent. The frontend still does not read values from
   `/inspect`. File:
   `/home/mahmoud/code/agenta/services/oss/src/agent/schemas.py:52`.

4. Stop force-injecting the skill. Set `AGENTA_FORCED_SKILLS = []`. Keep `force_skills`,
   `GETTING_STARTED_WITH_AGENTA_SKILL`, the slug constant, and the static catalog. The
   getting-started skill now reaches agents through the embedded default config, where the
   user can remove it. File:
   `/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:104`.
   Leave `AGENTA_FORCED_TOOLS = ["read", "bash"]` alone; those are Pi builtins for skill
   rendering, unrelated to the platform-op tools.

5. Frontend, removable defaults. The skill control currently renders a `__ag__` static
   skill as read-only and non-removable ("cannot be edited or removed"). Opt-out needs the
   reference removable. Split the two ideas: the skill's content stays read-only (it is
   Agenta's skill), but the embed in my config can be deleted. Verify the tools control
   renders `{"type":"platform","op":...}` entries and allows deleting them; if it does
   not, add that. Files:
   `/home/mahmoud/code/agenta/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SkillTemplateControl.tsx`
   and the tools control in the same folder. Adding or picking new platform tools is out
   of scope; only delete must work.

6. Tests. The agent-template default test asserts three sources today
   (`/home/mahmoud/code/agenta/services/oss/tests/pytest/unit/agent/test_default_agent_template.py`):
   builtin equals the bare builder, and the service equals bare plus extras. Keep
   builtin-equals-bare. Update the service test so the extras now include the frozen
   platform tools. Add a catalog test (in the API suite) that asserts the agent template's
   `data.parameters.agent` carries the platform tools and the skill embed, which is the
   real guarantee that the draft gets the defaults.

The defaults bake into the stored revision at create or commit time. Existing agents are
not touched. A new platform tool added to the catalog later appears only in agents created
after that, which is the correct behavior for opt-out defaults.

## Coordination

A separate skills subagent owns the getting-started skill content and any naming updates.
This design does not write skill content. It owns embed-by-default: the getting-started
skill arrives as an embedded default config item, referenced by `@ag.embed` to its stable
slug, present by default and removable. See the agent-creation-skills and skills-config
projects for the skill content and the static catalog.

## Interface design notes

This design adds no new wire field and no new contract surface. That is deliberate and
worth stating.

- The platform tool entries reuse the existing `platform` tool shape
  (`{"type": "platform", "op": "<name>"}`). The `op` is a stable identifier into the
  catalog. Role: config that selects behavior, plus a routing key (`op`) the resolver maps
  to a platform endpoint. No new field.
- The skill entry reuses the existing `@ag.embed` shape, referencing a server-owned skill
  by stable slug. Role: config plus a routing key (the slug). No new field.
- Decision 2 (no `is_active`) means we do not add a disable field. Delete is the existing
  present/absent semantics.
- Decision 3 (frozen list) means we store concrete enumerated entries, not a new wildcard
  token in the contract.

So the only real interface question was ownership: which layer owns the enriched default.
The answer, decided by Mahmoud, is the catalog template (with `/inspect` kept in sync), not
the portable SDK interface. The skill embed and the platform tools both resolve server-side
(the static catalog for the skill, the platform resolver and credentials for the tools). A
bare SDK interface that ran standalone could not resolve them. Keeping them at the catalog
and service layer respects the existing split and avoids breaking standalone SDK use of the
builtin agent.

## Risks and edge cases

- Several seeded tools are approval-gated by default in the catalog: `commit_revision` today,
  and `create_schedule`, `create_subscription`, and `test_subscription` once the builder ships.
  Seeding them does not change that. A new agent asks before it commits, schedules, subscribes,
  or runs a live trigger test. The seeded tools keep their catalog default permissions, and the
  user can edit them. This is intended; it is worth a line in the user-facing docs.
- The skill content is a placeholder today. That is fine. Real content lands separately; it
  is not this design's job.
- The catalog and `/inspect` defaults must stay in sync. Sourcing both from one builder
  call removes the drift that caused this gap in the first place.
- Frontend delete of a static-skill embed must remove only my reference, not affect the
  shared static skill. The slug points at a read-only catalog entry; deleting the embed
  just drops the list item.

## Out of scope and follow-ups

- Disable-but-keep (an `is_active` or equivalent), with the resolver and wire drop step.
- The debug-mode UX where defaults are not shown by default.
- A picker to add platform tools or skills back after deleting them.
- Real getting-started skill content.

## Resolved: where the enriched default lives

Decided by Mahmoud. The catalog template carries the enriched default (the frozen
platform-tools list plus the getting-started skill embed). The bare SDK builtin interface
stays bare. Server-resolved Agenta defaults do not go into the portable SDK default.
`/inspect` is not used for the draft's values; if it is not in `/inspect`, we do not rely on
`/inspect`, we use the catalog template. The catalog-templates path now sources the agent
default from the enriched default rather than the bare builtin, and the tests that assert
"builtin equals bare" and "service equals bare plus extras" are updated accordingly.
