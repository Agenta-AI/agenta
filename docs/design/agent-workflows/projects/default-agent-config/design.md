# Design: the playground build kit (the frontend injects, the backend informs)

Status: draft for Mahmoud's review. Grounded in code on `gitbutler/edit` over
`big-agents`, 2026-06-28. Paths are absolute. See `research.md` for the code trace.

This is the second rewrite. Mahmoud rejected the first rewrite's core model: it made the
backend agent service inject the kit at run time, behind a run flag. That is gone. The
corrected model moves the injection to the frontend and leaves the backend with one job,
to inform. The section "What changed and why" records the pivot.

## Problem and goal

A new agent arrives almost bare. The playground still needs to give that agent the tools,
the skill, and the permissions it takes to build and improve itself, while the user works on
it. None of that authoring scaffolding belongs in the agent the user ships.

The platform tools (find capabilities, query workflows, commit a revision), the Agenta
authoring skill, and the build permissions (write files, execute code) are a build aid. They
are not the user's agent. They exist so the assistant can scaffold and edit the agent in the
playground. Once the agent ships, it should carry only what the user authored.

So the kit is shown and used in the playground, but never committed. The goal of this design
is to decide who shows it, who uses it, and who keeps it out of the commit.

## What changed and why

The first rewrite put the injection in the backend. The agent service merged the kit into
the effective config at a run-prep step, gated by a `flags.inject_build_kit` run flag.
Mahmoud rejected that. His direction, verbatim in the PR review:

> It should not be the agent service that injects the kit. This should be a front-end
> matter. The front-end injects the kit when used in the playground as part of the
> parameters of the agent template. The service itself should not know about it.

> The frontend should own the business logic for setting these. The only thing the backend
> should do is give information and inspect what this build kit is: which skills, which
> tools, which permissions.

So the model flips. The service stops injecting. The backend stops gating. The frontend owns
the injection, and the backend's only build-kit job is to expose the kit's information
through `/inspect`. The rest of this document follows from that one change.

## The corrected model

Three actors, three clear jobs.

- **The agent service stays dumb.** It receives an agent template at `parameters.agent` and
  runs exactly that. It does not know the build kit exists. There is no run-prep injection
  and no `inject_build_kit` run flag. If the platform tools, the authoring skill, and the
  build permissions reach a run, they reach it because they are already inside the
  `parameters.agent` the service was handed. The service resolves them the same way it
  resolves any tool or skill.
- **The backend informs.** Its only build-kit job is to expose the kit's information through
  `/inspect`: which skills, which tools, which permissions the kit holds, and, for each, the
  exact agent-template entry that item would contribute. This is read-only information. The
  backend assembles it and never acts on it.
- **The frontend owns the logic.** It reads the kit's information from `/inspect`. It shows
  the kit in the advanced drawer with an enable or disable toggle. When the kit is on, the
  frontend injects the kit's skills, tools, and permissions into `parameters.agent` in the
  run request it sends. On commit, the frontend leaves the kit out, so the committed config
  holds only the user's own config.

The "shown but not committed" property now belongs to the frontend. The frontend includes
the kit in the run payload and excludes it from the commit payload. Nothing in the backend
adds or strips the kit.

This is also where the property gets cheap. The kit never enters `parameters.agent`, the
config tree the playground edits and commits. It lives only in the read-only descriptor and,
on a kit-on run, in the outbound run payload. There is no strip step on commit, because the
kit was never in the tree the commit serializes. There is no run flag, because a kit-on run
is just a run whose `parameters.agent` already carries the extra items.

A deployed agent therefore can never run with the kit. The kit is not in its stored config,
and the backend never adds it. The only place the kit exists is the descriptor (information)
and a live playground run payload (the frontend's doing). That is a stronger safety
guarantee than a server flag: there is no path that injects authoring power into a published
run, because nothing persists the kit and nothing on the run path adds it.

## The `/inspect` build-kit descriptor (the central question)

Mahmoud's central question: how do we put the build-kit information in `/inspect`, so the
frontend can act on it? This section answers it, organized by role per the `design-interfaces`
skill.

### Where it sits

Deliver the descriptor in the `/inspect` response at `revision.data.build_kit`, a read-only
sibling of `revision.data.schemas`. The frontend already fetches `/inspect` per workflow, so
the drawer reads the descriptor with no new request. The descriptor is platform-owned. The
frontend reads it, renders it, and injects from it. It never writes it, merges it back, or
echoes it to the backend.

The descriptor is a sibling of the config, never a member of `parameters.agent`. That
placement is the load-bearing decision. The kit is display-and-inject information that the
platform owns and the session scopes. The agent config is user-owned data that the revision
persists. They answer different questions, so they do not share a contract.

### The shape

Grouped by kind. Each kind renders as one read-only group in the drawer and routes to one
destination in `parameters.agent`.

```jsonc
{
  "build_kit": {
    "skills": [
      {
        "key": "__ag__getting_started_with_agenta", // the skill slug (identity)
        "name": "agenta-authoring",                  // display label
        "description": "Scaffold and edit this agent's tools, skills, and config.",
        "config": { "@ag.embed": { "slug": "__ag__getting_started_with_agenta" } }
      }
    ],
    "tools": [
      {
        "key": "find_capabilities",                  // the platform op (identity)
        "name": "Find capabilities",
        "description": "Discover the tools and workflows available to this agent.",
        "config": { "type": "platform", "op": "find_capabilities" }
      }
    ],
    "permissions": [
      {
        "key": "write_files",
        "name": "Write files",
        "description": "Filesystem read and write while building.",
        "status": "on",                              // read-only policy state, the green pill
        "config": { "sandbox": { "permissions": { "write_files": "allow" } } }
      }
    ]
  }
}
```

### Why each row carries `config`

This is the pivot from the rejected model, so it is worth stating plainly.

In the rejected model the backend injected the kit, so the descriptor only needed display
fields: `key`, `name`, `description`, and a permission `status`. The frontend rendered those
labels and flipped a flag; the backend turned `find_capabilities` into the real platform tool
config server-side.

In the corrected model the frontend injects the kit. So each row must also carry the exact
agent-template entry it contributes, because the frontend, not the backend, now writes that
entry into `parameters.agent`. The `config` field is that entry: a platform tool config for a
tool row, an `@ag.embed` reference for a skill row, a sandbox-permission fragment for a
permission row.

Carrying `config` keeps the contents fully backend-owned. The frontend does a pure structural
merge. It appends `skills[].config` to `parameters.agent.skills`, appends `tools[].config` to
`parameters.agent.tools`, and merges `permissions[].config` into the agent's sandbox section.
It never builds a tool's wire shape, never knows the authoring skill's slug, and never decides
which permission to elevate. It owns the business logic (when to inject, where each kind goes,
run versus commit). The backend owns the data (which items, and the exact form of each).

Because each `config` is an ordinary `parameters.agent` entry, the dumb service already knows
how to run it. A kit-on run is indistinguishable on the wire from a config the user authored
by hand with those same tools. That is what lets the service stay dumb.

I considered the leaner alternative: keep only `key`, `name`, `description`, and `status`, and
have the frontend derive each injected entry from `key` plus kind. I rejected it. It pushes
the platform tool wire shape and the skill embed shape into the frontend, and it cannot
express a permission setting from a key alone. Open question 4 revisits this if we want the
leaner shape after all.

### The role of each field

Run through `design-interfaces`, field by field:

- The descriptor as a whole is platform-owned, session-scoped information. It is a sibling of
  the config, never part of `parameters.agent`.
- `skills` / `tools` / `permissions` are routing. The kind picks both the drawer group and the
  destination list in `parameters.agent`. The three kinds differ in exactly one visible way: a
  permission row carries a status the others do not.
- `key` is a stable, platform-owned identity (the skill slug, the platform op, the permission
  key). The drawer keys rows on it. It is not the visible label.
- `name` and `description` are display metadata: the row's label and its one-line purpose.
- `status` (permission rows only) is read-only policy state (`on` or `off`). It reflects what
  the kit grants for authoring. The drawer renders it as the green `On` pill. Skill and tool
  rows carry no status.
- `config` is the agent-template fragment the row contributes. It is data the frontend writes
  into the run payload. Despite the generic word, it has one exact meaning here: the
  `parameters.agent` entry for this one item.

No field plays two roles. The kind tag is implicit in the array a row sits in. The labels and
the injectable form are the backend's to own.

### How the backend assembles it

One backend builder produces all three groups, in the inspect layer, reading sources that the
SDK already owns:

- `tools` from `PLATFORM_OPS`
  (`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/platform/op_catalog.py`). Each op
  becomes a row: `key` is the op, `name` and `description` come from the catalog, and `config`
  is `{ "type": "platform", "op": <op> }`. Reading the catalog at assembly time means a new op
  added by the builder-tools project (`#4919`) joins the kit with no edit here.
- `skills` from the authoring skill, the SDK constant `GETTING_STARTED_WITH_AGENTA`
  (`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`),
  served read-only under the reserved `__ag__*` slug. The row's `key` is the slug, `name` and
  `description` come from the skill, and `config` is the `@ag.embed` reference to that slug.
- `permissions` from the build-permission set (write files, execute code). Each becomes a row
  with `status: "on"` and a `config` that is the sandbox-permission fragment the frontend
  merges into the agent's sandbox section.

The builder lives in the backend inspect layer and reads SDK-owned constants. The agent
service's run path never references it. That keeps the run path, and therefore the service,
kit-unaware.

### How the backend serves it

The `/inspect` response already carries `revision.data.schemas`, forwarded from the service's
schema declaration through the API inspect proxy
(`/home/mahmoud/code/agenta/api/oss/src/apis/fastapi/applications/router.py`). The inspect
layer attaches `revision.data.build_kit` alongside `schemas`, assembled by the builder above.
Confirm the proxy passes `revision.data` through rather than allow-listing fields, so the new
sibling reaches the frontend.

## The frontend logic

The frontend owns three behaviors. All three read the same descriptor; none touch the
backend's run wire.

1. **Read.** On loading the workflow, the frontend reads `revision.data.build_kit` from the
   `/inspect` response. It renders the three groups in the drawer (next section). It hardcodes
   no item list, no label, and no wire shape.

2. **Toggle and inject on run.** The drawer holds one piece of session state,
   `buildKitEnabled`, default on. When the frontend builds a run request, it injects the kit
   if the toggle is on. The injection point is `buildAgentRequest`
   (`/home/mahmoud/code/agenta/web/packages/agenta-playground/src/state/execution/agentRequest.ts`),
   which composes the `/invoke` body's `data.parameters` from the draft-aware config. With the
   kit on, the builder appends `build_kit.skills[].config` and `build_kit.tools[].config` to
   the run copy's `parameters.agent` lists and merges `build_kit.permissions[].config` into its
   sandbox section, then sends that. With the kit off, it sends the user's config unchanged,
   so the user previews the agent as users will see it. The builder already transforms
   `parameters` before sending (it drops half-filled entries and normalizes tool shapes), so a
   kit merge is the same kind of pre-send step, on a throwaway copy.

3. **Exclude on commit.** The commit path reads the user's config from `entity.data.parameters`
   through `prepareCommitParameters`
   (`/home/mahmoud/code/agenta/web/packages/agenta-entities/src/workflow/state/commit.ts:68`).
   The kit was never written into `entity.data.parameters`, so the commit excludes it with no
   strip step. The descriptor and the kit-on run payload are the only places the kit ever
   appears.

The run wire stays byte-compatible. The backend cannot tell a kit-on run from a hand-authored
config with the same items, and it does not need to.

## The UI drawer (folded in)

Mahmoud asked for this design to cover both the inspect information and the drawer UI he
designed, in one document, not split into a separate PR. So the drawer design lives here. It
recomposes existing drawer parts; nothing below is novel UI. The designer handoff
(`/home/mahmoud/code/agenta/design_handoff_advanced_build_kit/README.md`) is the
high-fidelity spec; the `.dc.html` is a visual reference, not code, and `support.js` is mock
runtime to ignore.

### The drawer today

Verified on this branch, so the changes land on real structure.

- The advanced drawer is `AgentTemplateControl.tsx`
  (`/home/mahmoud/code/agenta/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx`).
  It renders inside the `SectionDrawer` shell (icon, title, scroll body, Cancel and Save).
- The advanced body already stacks three groups, separated by top borders, not yet
  collapsible: Authentication (`:1517`), Execution environment (`:1530`), and Permissions
  (`:1565`). These configure the committed agent.
- The collapsed-header summary the drawer already computes (`advancedSummary`, `:1501`) reads
  values such as `Agenta-managed` and `Sandbox: Local` from existing state. The per-section
  summaries reuse those values.
- `SkillTemplateControl.tsx:205` already renders an Agenta-owned skill read-only: "Provided by
  Agenta. This skill cannot be edited or removed," with no editor and no delete. This is the
  read-only pattern the kit reuses, lifted from the per-item list into the kit section.

### Change 1: make the advanced sections collapsible

Each advanced group becomes a collapsible accordion item, the behavior the playground's left
panel already uses, so the groups stop rendering as one long scroll.

- Default state is collapsed. Several sections can be open at once; it is not single-open.
- The header row shows the section icon, the title, a one-line summary on the right, then a
  chevron that rotates when open.
- The body mounts only when expanded. Its content is the section's existing controls,
  unchanged.
- Summaries reuse state already present: Authentication shows `Agenta-managed`, Execution
  environment shows `Sandbox: Local`, Permissions shows `Auto`. The build kit shows no text
  summary; its toggle sits in the header instead.

This change carries no contract and no commit logic. It is drawer polish on the existing
groups, and it can ship on its own (open question 5).

### Change 2: add the "Playground build kit" section

A new collapsible section at the top of the drawer, above Authentication, with a subtly warmer
background (`#fcfcfa`) so it reads as a distinct playground-only layer.

- **Header**: a wrench icon, the title `Playground build kit`, a restrained `Removed on commit`
  tag (a small amber dot plus text, no pill, no banner), an enable or disable toggle, and the
  chevron. The toggle's click stops propagation, so flipping the kit does not also expand the
  section.
- **Body, when expanded**: an intro paragraph that ends with "None of this is part of the
  published agent." When the kit is off, an info note that the assistant can no longer create
  files, run code, or edit the agent here. Then the three groups.
- **The three groups**, rendered straight from `build_kit`, one labelled group per kind, in
  order: skills, tools, permissions. Every row is dimmed and locked, reusing the read-only
  pattern from `SkillTemplateControl.tsx:205`. Permission rows additionally render the green
  `On` pill from each row's `status`. The drawer hardcodes no item list; it renders whatever
  the descriptor carries. The designer's sample rows (`agenta_authoring`, `commit_version`,
  `Write files`) are illustrative.

### The toggle wiring (the corrected part)

This is where the drawer differs from the rejected model. The toggle does not set a run flag.
The toggle is `buildKitEnabled`, session state, default on. The frontend reads it when it
builds the run request and injects the kit's `config` entries into `parameters.agent` when it
is on (frontend logic, step 2). The drawer writes nothing into the config and never echoes the
descriptor. The toggle is a playground preference, not a field on the revision.

### Keep two permission ideas distinct

The drawer now holds two things that both say "permissions," and they must not read as one
setting.

- The committed Permissions group, and the Execution environment group, configure the agent's
  own permissions and sandbox. The user edits them, they commit, they ship.
- The build kit's PERMISSIONS group is a read-only reflection of the permissions the kit grants
  for authoring. It is dimmed, locked, tagged removed on commit, and never committed.

The structure does the heavy lifting: the kit's permissions live inside the kit section, behind
the same dimming, lock, and removed-on-commit tag as the rest of the kit, while the agent's own
Permissions group stays an editable, committed control elsewhere. The intro paragraph and the
tag carry the distinction in words. This is worth a deliberate review with the designer, because
the two ideas sit close together and a user who conflates them could believe the agent ships
with write-files and execute-code permission.

## What the backend explicitly does NOT do

This section exists because the rejected model lived in the backend. State the negatives so no
implementer re-adds them.

- **No service-side injection.** The agent service does not merge the kit into the config at
  run-prep. There is no kit merge in `_agent`
  (`/home/mahmoud/code/agenta/services/oss/src/agent/app.py`). The service runs
  `parameters.agent` as received.
- **No run flag.** There is no `flags.inject_build_kit` on the run request and none on
  `WorkflowInvokeRequestFlags`. The toggle is client session state. The run wire gains no
  field.
- **The service does not read `build_kit`.** The descriptor is assembled by the inspect layer
  and consumed by the frontend. The service's run path never references it. The service does
  not know the kit exists.
- **No backend strip on commit.** The backend does not remove kit items from a committed
  config, because the kit never enters the committed config. The frontend simply does not put
  it there.

## Published default stays bare

The published-config default does not carry the kit. A new agent's stored config is bare: no
platform tools, no authoring skill, no elevated sandbox.

Today `schemas.py` enriches the published default with the authoring skill and the sandbox
boundary (`build_agent_v0_default(skill_slug=..., include_sandbox_permission=True)` at
`/home/mahmoud/code/agenta/services/oss/src/agent/schemas.py:52`). Under this model those two
belong to the kit, not the published default. Revert the enrichment so the `/inspect` schema
default and the catalog template both carry the bare default, the same value the SDK builtin
carries. The skill and the sandbox elevation reach a run only through the kit, by the
frontend's injection.

That keeps two distinct things in `/inspect` with two distinct roles: the bare schema default
(the seed for the user's persisted config) and the `build_kit` descriptor (the platform's
session overlay). Overloading the schema default to also mean "the kit" was the exact role
confusion this design avoids.

The authoring skill stops reaching runs through the harness force as well. Today the
`pi_agenta` harness unions `AGENTA_FORCED_SKILLS` into every run, always on and not toggleable
(`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:104`).
A forced skill cannot be toggled, which contradicts the kit's toggle. So the authoring skill
must come from the kit (frontend injection), not the force. Set `AGENTA_FORCED_SKILLS = []`,
keeping `force_skills` for a future genuinely-forced item. This touches the skills project's
surface, so confirm it with them (open question 2).

## Interface notes (design-interfaces)

The model rests on role splits, not feature splits.

- **Information versus action.** The backend's `build_kit` is pure information: platform-owned,
  read-only, session-scoped. The frontend acts on it. The split keeps the backend free of the
  business logic and the frontend free of the data. It is the heart of the corrected model.
- **Sibling versus member.** The descriptor is a sibling of the config in the `/inspect`
  response (`revision.data.build_kit`), never a member of `parameters.agent`. Display-and-inject
  information stays out of the persisted, user-owned config. That placement earns "shown but not
  committed" with no strip step.
- **Display versus inject, per row.** Each row carries display fields (`name`, `description`,
  `status`) and one inject field (`config`). The two faces are different fields, never one
  overloaded field. The frontend reads display fields to render and the inject field to merge.
- **Session preference versus persisted config.** The toggle is a playground preference in
  client session state. It is not a field on the revision and not a flag on the run. If we ever
  persist it, it is a UI preference keyed to user and agent, never config on the agent.
- **No new field on the stored config.** The stored contract (`parameters.agent`) is unchanged.
  The descriptor lives in the inspect response; the toggle lives in the client. The run payload
  carries ordinary `parameters.agent` entries the service already understands.

## Change set, by layer

1. **Build-kit builder (backend, new).** One builder in the inspect layer assembles the
   descriptor: `tools` from `PLATFORM_OPS`, `skills` from the authoring skill, `permissions`
   from the build-permission set, each row with `key`, `name`, `description`, `config`, and
   `status` on permissions. Reads SDK-owned sources. Not referenced by the service run path.

2. **Inspect response (backend).** Attach `revision.data.build_kit` alongside
   `revision.data.schemas` in the `/inspect` response. Confirm the API inspect proxy
   (`/home/mahmoud/code/agenta/api/oss/src/apis/fastapi/applications/router.py`) passes
   `revision.data` through.

3. **Published default goes bare (backend).** Revert the `schemas.py` enrichment so the schema
   default is bare. Move the authoring skill and the sandbox elevation into the kit. Catalog
   needs no change.

4. **Stop force-injecting the skill (SDK).** Set `AGENTA_FORCED_SKILLS = []`
   (`agenta_builtins.py:104`). The authoring skill reaches a run through the kit's frontend
   injection, not the harness force. Coordinate with the skills project.

5. **Frontend read and render (web).** Read `revision.data.build_kit` from `/inspect`. Render
   the drawer's "Playground build kit" section and make the advanced sections collapsible
   (drawer changes above).

6. **Frontend inject on run (web).** In `buildAgentRequest` (`agentRequest.ts`), when the
   toggle is on, merge the descriptor's `config` entries into the run copy's `parameters.agent`
   (skills and tools appended, permissions merged into the sandbox). Off sends the bare config.

7. **Frontend exclude on commit (web).** No change needed beyond confirming the kit is never
   written into `entity.data.parameters`, so `prepareCommitParameters` (`commit.ts:68`) excludes
   it for free.

8. **Tests.** Backend: the builder lists the platform ops, the authoring skill, and the build
   permissions, each with a `config`; the `/inspect` response carries `build_kit` beside
   `schemas`; the published default is bare across the builtin, `/inspect`, and the catalog.
   Frontend: a kit-on run request carries the platform tools, the authoring skill, and the
   elevated sandbox in `parameters.agent`; a kit-off run carries the bare config; a commit
   excludes the kit either way. Update the default-template test
   (`/home/mahmoud/code/agenta/services/oss/tests/pytest/unit/agent/test_default_agent_template.py`)
   to assert the bare default.

## Risks and edge cases

- **Safety.** The kit grants self-commit, write files, and execute code. It must never reach a
  production run. It cannot, because nothing persists it and the run path never adds it. A
  deployed agent runs its stored config, which has no kit. State this and assert it in a test
  (a published agent's resolved config never contains the platform ops or the elevated sandbox).
- **No new attack surface.** The run API already accepts and resolves whatever tools and
  permissions a config carries. A hand-authored config with the platform ops already runs them
  today. The kit grants the frontend no capability the run API did not already accept; it only
  saves the user from authoring those entries by hand.
- **Kit off.** Turning the kit off produces a run with the user's config only, so the user
  tests the agent as users will see it. This is the no-inject path, the simple default.
- **Existing agents.** They gain the kit in the playground with no migration, because the
  frontend injects it from the descriptor at run time. Nothing is baked, so nothing goes stale.
- **Permission overlap.** The agent's own sandbox is a committed field. The kit's build
  permissions are a session-only elevation the frontend merges on a kit-on run. Keep them
  separate so a kit-off run uses the agent's own permissions.

## Out of scope and coordination

- The authoring skill's content and naming are owned by the skills project (`#4918`). This
  design references the skill by its stable slug. It does not write skill content.
- The builder-tools project (`#4919`) adds more platform ops. The builder reads `PLATFORM_OPS`
  at assembly time, so new ops join the kit automatically.
- Per-item edit or delete of kit items, and a picker to add platform tools to the published
  agent, are out of scope. The kit is whole-toggle and read-only in v1.
- The model change in this rewrite ripples to `#4918`, `#4919`, `#4920`, which still reference
  the rejected backend-injection model. They are not edited here; the orchestrator propagates
  the corrected model after Mahmoud approves it.

## Open questions for Mahmoud

1. **Toggle persistence.** Ephemeral per playground session (resets to on), or a stored
   playground preference per user and agent. I lean ephemeral for v1: smaller surface, and the
   kit defaults on.
2. **Confirm the published default goes fully bare**, dropping the authoring skill and the
   sandbox boundary from the schema default into the kit, and setting `AGENTA_FORCED_SKILLS =
   []`. This touches the skills project's surface, so it needs their nod.
3. **Permissions group: read-only, or independently flippable?** The kit's PERMISSIONS group
   reflects what the kit grants. Purely read-only under the single kit toggle (this design), or
   should the user flip the build permissions off while keeping the rest of the kit on? I lean
   read-only.
4. **Carry `config` per row, or derive it from `key`?** This design carries `config` so the
   frontend does a pure merge and owns no wire shapes. The leaner alternative drops `config`
   and rebuilds each entry from `key` plus kind, which pushes the platform tool and skill shapes
   into the frontend and cannot express a permission setting from a key. I lean carry `config`.
5. **Ship Change 1 (collapsible sections) with the kit, or separately?** It is independent UI
   polish with no contract and no logic. I lean separate, since it de-risks the larger change
   and unblocks nothing.
