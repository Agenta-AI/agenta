# Design: the playground build kit (inject, do not commit)

Status: draft for Mahmoud's review. Grounded in code on `gitbutler/edit` over
`big-agents`, 2026-06-28. See `research.md` for the code trace. This rewrite replaces an
earlier approach (materialize the defaults into the catalog template). That approach is
dropped. See "What changed and why".

## Problem and goal

A new agent arrives almost empty. We want the playground to give the agent the tools and
skills it needs to build and improve itself, without writing those tools and skills into the
published agent.

The platform tools and the Agenta authoring skill are a build aid, not part of the user's
agent. The user is shipping their agent. The platform ops (find capabilities, query
workflows, commit a revision) and the authoring skill exist so the agent can scaffold and
edit itself while the user works on it in the playground. Once the agent ships, it should
not carry Agenta's authoring tools unless the user added their own.

So the model is inject, not commit. The backend injects the kit into the playground
session, for display and for the run. The commit writes only the user's real config.

## What changed and why

The earlier draft made the platform tools and the skill embed part of the agent config and
baked them into the catalog template, so a new agent committed them. Mahmoud reviewed that
and rejected it. The defaults should not be committed to the agent. They are a playground
overlay. The designer handoff (`design_handoff_advanced_build_kit`) names this exactly: a
"Playground build kit" that is "Removed on commit" and "None of this is part of the
published agent".

Two consequences. The published-config default stays bare. The build kit becomes a separate
backend concept that the playground injects and the commit strips.

This is also simpler. Nothing about the kit is persisted into the agent, so there is no
merge, no per-item delete marker, and no list of suppressed defaults in the stored config.

## The model

The build kit is a backend-defined set of three things:

- Tools: the platform ops, sourced from the catalog (`PLATFORM_OPS`).
- Skills: the Agenta authoring skill.
- Permissions: the sandbox elevation the agent needs to build, write files and execute code.

The kit has one source of truth in the backend. It flows three ways.

- Display. The backend exposes the kit so the Advanced drawer renders it as a read-only
  group the user can toggle on or off. The drawer owns that UX, not this design.
- Run. When the playground runs the agent with the kit on, the backend injects the kit into
  the effective config for that run, before tool and skill resolution. The agent runs with
  the platform tools, the authoring skill, and the build permissions.
- Commit. The commit writes only the user's config. The kit is never in the stored config,
  so there is nothing to strip. It is absent by construction.

The kit is off by default for any plain run of the agent. The playground turns it on. A
production run of a published agent never injects it. This matters: the kit lets the agent
rewrite itself and run code, which is a build-time power, not a shipped one.

## The three questions

### 1. How do we do this smartly, without too much complexity?

Never commit the kit. That single rule removes the hard parts. There is no base-plus-patch
merge in the stored config, no tombstone to record a deleted default, and no suppressed-list
field. The stored config holds only the user's items, exactly as it does today.

The kit is one backend definition. The run path injects it into the in-memory effective
config at the existing run-prep step, then reuses the tool, skill, and permission resolution
that already runs. The display path reads the same definition. The commit path does nothing
new, because the kit was never in the config it serializes.

The published-config default does not change. It stays bare. We do not touch the catalog
template or the new-config seed. We add one concept (the kit) and one run flag (inject the
kit for this session), and we move the authoring skill out of the published default and into
the kit.

### 2. Can we avoid hardcoding this in the frontend?

Yes. The kit's contents come entirely from the backend. The backend names the tools, the
skill, and the permissions, with labels for the drawer. The frontend renders the groups it
receives and owns only the on or off toggle. It never lists a platform op or a skill name in
its own code. The designer handoff says the same: "confirm the real set with the backend",
and "the build-kit contents come from whatever Agenta already injects".

### 3. Where does the injection happen, and how do we keep it out of the frontend?

Two injection points, one backend source.

- Display: the backend serves a build-kit descriptor. The drawer reads it. The set is
  decided server-side.
- Run: the agent service injects the kit into the effective config at run-prep, in `_agent`
  (`/home/mahmoud/code/agenta/services/oss/src/agent/app.py:207`), before
  `resolve_tools(agent_template.tools)` at line 227. Gated by the run flag. The injection is
  harness-agnostic, so it works on `pi_core` as well as `pi_agenta`.

The frontend never decides the set. It reads it for display and sends the toggle for the
run.

## Does `/inspect` already carry enough, or do we add a signal?

`/inspect` is the right channel. The frontend already fetches it per workflow, so the drawer
reads it with no new call. But the value `/inspect` carries today does not suffice. It
carries the published-config schema default at
`revision.data.schemas.parameters.properties.agent.default`
(`/home/mahmoud/code/agenta/services/oss/src/agent/schemas.py:52`). That value's role is the
seed for the user's persisted config. The build kit's role is an ephemeral overlay that the
run injects and the commit excludes. Those are two different roles. Overloading the schema
default to also mean "the kit to inject and strip" is the exact role confusion that caused
the original gap, where the skill embed sat in a default the draft never read.

So deliver a dedicated descriptor in the `/inspect` response, as a new read-only sibling of
`schemas`, not inside the schema default. After this, `/inspect` carries two distinct things
with two distinct roles: the bare schema default (the seed for the user's config) and the
`build_kit` descriptor (the platform overlay). The exact descriptor shape is the contract
below.

Cleaning up the schema default is part of this. Today `schemas.py` enriches the published
default with the skill embed and the sandbox boundary. Under this model those belong to the
kit, not the published default. Move them. The published default returns to bare, the same
value the SDK builtin already carries.

## The build-kit contract (the drawer reads this)

The advanced-build-kit drawer renders this exact shape and never invents its own. Field
names are part of the contract.

Delivered in the `/inspect` response at `revision.data.build_kit`, a read-only sibling of
`revision.data.schemas`. It is platform-owned. The frontend reads it, renders it, and never
writes, merges, or echoes it back.

```
build_kit:
  skills:      [ { key, name, description } ]                  # key = the skill slug
  tools:       [ { key, name, description } ]                  # key = the platform op
  permissions: [ { key, name, description, status } ]          # status only on permissions
```

- Grouped by kind: `skills`, `tools`, `permissions`. The drawer renders one read-only group
  per kind, in that order.
- Every row carries `key` (a stable identifier), `name` (the display name), and
  `description` (the one-line purpose). `key` is the slug for a skill, the op for a tool, and
  the permission key for a permission. The kind is the array the row sits in, so a row needs
  no kind tag.
- `permissions` rows additionally carry `status` (for example `on`), which the drawer shows
  as the green status pill. Skills and tools rows have no `status`.
- The source: `tools` from `PLATFORM_OPS` (the catalog owns the name, description, and per-op
  permission), `skills` from the authoring skill (its slug, name, description), `permissions`
  from the build permission set (write files, execute code). One backend builder produces all
  three groups, and the same builder feeds the run-time injection, so the displayed kit and
  the injected kit are the same set.

The per-run flag the drawer toggle controls:

- `flags.inject_build_kit` (boolean), on the run request, request-scoped. The drawer's
  enable or disable toggle sets it. When the kit is off the drawer sends `false`, the run
  skips injection, and the agent runs with the user's config only. It defaults to off
  server-side, so a request that omits it (any non-playground caller) never injects the kit.
  The drawer defaults the toggle on, so a normal playground run sends `true`.

The two names intentionally pair: `build_kit` is the read-only catalog of what the toggle
controls, and `inject_build_kit` is the toggle. They live in different messages (the inspect
response versus the run request), so they never appear together.

## Change set, by layer

1. Build-kit definition. One backend builder returns the kit (tools from `PLATFORM_OPS`,
   the authoring skill, the build permissions), with identifiers and labels. Single source.
   The tool set is read from the catalog at call time, so a new op added by the builder-tools
   project (`#4919`) joins the kit with no edit here. Likely home: the agent service or a
   shared SDK helper that both the service and the API import.

2. Display signal. Serve the `build_kit` descriptor (the contract above) in the `/inspect`
   response at `revision.data.build_kit`, a read-only sibling of `schemas`. The API inspect
   proxy
   (`/home/mahmoud/code/agenta/api/oss/src/apis/fastapi/applications/router.py:473`)
   forwards the new sibling alongside `schemas`; confirm it passes `revision.data` through
   rather than allow-listing fields. The same backend builder that produces the descriptor
   feeds the run injection.

3. Run injection. In `_agent`
   (`/home/mahmoud/code/agenta/services/oss/src/agent/app.py:207`), when
   `flags.inject_build_kit` is true, merge the kit's tools into `agent_template.tools`, its
   skill into `agent_template.skills`, and its permissions into the sandbox permission, before
   the existing `resolve_tools` / `resolve_mcp_servers` calls. Reuse all existing resolution.
   The flag rides `WorkflowInvokeRequestFlags` (`app.py:214`), defaults off server-side, and
   the playground sends it on.

4. Published default stays bare. Revert the `schemas.py` enrichment so the `/inspect` schema
   default and the catalog template both carry the bare default (no skill, no tools). The
   skill embed and the sandbox boundary move into the kit. File:
   `/home/mahmoud/code/agenta/services/oss/src/agent/schemas.py:52`. The catalog
   (`/home/mahmoud/code/agenta/api/oss/src/resources/workflows/catalog.py`) needs no change;
   the earlier materialize edit is dropped.

5. Stop force-injecting the skill. Set `AGENTA_FORCED_SKILLS = []`
   (`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:104`).
   The authoring skill now reaches a playground run through the kit injector, not through the
   `pi_agenta` harness force. Keep `force_skills`, `force_tools`, and the skill constant for a
   future genuinely-forced item.

6. Tests. The default-template test
   (`/home/mahmoud/code/agenta/services/oss/tests/pytest/unit/agent/test_default_agent_template.py`)
   asserts the service default equals bare plus the skill and sandbox extras. Update it: the
   published default is now bare across the builtin, `/inspect`, and the catalog. Add a test
   that the build-kit descriptor lists the platform ops and the authoring skill, and a
   run-prep test that an inject-kit run resolves the platform tools while a kit-off run does
   not.

## Interface design notes

The model rests on three clean separations. Each is a semantic-role split, not a feature
split.

- Inject versus commit. The kit is injected at session time, for display and for the run. It
  is never written to the stored revision. The revision holds only user data. Role of the
  kit: platform-owned policy applied at runtime. Role of the stored config: user-owned data.
- Default versus override. The kit is the platform's default capability set, managed by
  Agenta and not edited per item in v1. The user's config is the user layer. There is no
  per-item override of a kit item, so there is no merge and no precedence rule to define yet.
- Display versus persisted. The kit is display and session ephemeral. The agent config is
  persisted. The toggle is a playground preference. It is not part of the persisted agent
  config. If we persist the toggle at all, it is a playground or UI preference keyed to the
  user and agent, never a field on the revision.

Where each new field sits, by role:

- The `build_kit` descriptor is platform-owned and read-only. It is a sibling of the config
  in the `/inspect` response (`revision.data.build_kit`), never a member of `parameters.agent`.
  The frontend reads it, never writes it. Role: a platform-declared capability catalog for
  display and runtime, not user data.
- The `inject_build_kit` flag is request-scoped policy. It rides the run request flags, not
  the config. It defaults to the safe value, off, so a raw `/invoke` never grants the agent
  authoring tools or execute-code by accident. Role: a per-run mode the playground sets.

The design adds no field to the stored agent config. The `build_kit` descriptor lives in the
inspect response, and the `inject_build_kit` flag lives on the run request. The stored
contract (`parameters.agent`) is unchanged.

## Risks and edge cases

- Safety. The kit grants self-commit and execute-code. It must never inject on a production
  run. The flag defaults off server-side and only the playground turns it on. State this in
  the docs and assert it in a test.
- The toggle off path. Turning the kit off must produce a run with the user's config only, so
  the user tests the agent as users will see it. That is the no-inject path, which is the
  default, so it is the simple case.
- Existing agents. They gain the kit in the playground with no migration, because the kit is
  injected, not stored. Nothing is baked, so nothing goes stale.
- Permissions overlap. The agent's own sandbox permission is a real committed field. The
  kit's build permissions are a separate, session-only elevation. The drawer shows the kit's
  permissions as a read-only status, distinct from the agent's own sandbox config. Keep the
  two clearly separated so a kit-off run uses the agent's own permissions.

## Out of scope and coordination

- The Advanced drawer UX (collapsible sections, the build-kit toggle, the read-only dimmed
  rows) is owned by the advanced-build-kit project and the designer handoff. This design
  feeds it the backend descriptor. It does not design the drawer.
- The authoring skill content and naming are owned by the skills project (`#4918`). This
  design references the skill by its stable slug. It does not write skill content.
- Per-item edit or delete of kit items, and a picker to add platform tools to the published
  agent, are out of scope. The kit is whole-toggle and read-only in v1.

## Settled while drafting

- Where the descriptor lives. In the `/inspect` response, at `revision.data.build_kit`, a
  read-only sibling of `schemas`. The drawer project depends on this exact channel, so it is
  fixed, not open.

## Open questions for Mahmoud

1. The toggle's persistence. Ephemeral per playground session (resets to on), or a stored
   playground preference per user and agent. I lean ephemeral for v1. It is the smaller
   surface and the kit defaults on.
2. Confirm the published default goes fully bare, including dropping the skill embed and the
   sandbox boundary from the `/inspect` schema default, with both moving into the kit. This
   touches the skills project's surface, so it needs their nod too.
