# Design: the playground build kit (an agent-template overlay)

Status: draft for Mahmoud's review. Grounded in code on `gitbutler/edit` over `big-agents`,
2026-06-28. Paths are absolute. See `research.md` for the code trace.

## Problem and goal

A new agent arrives near-bare. While the user builds it in the playground, the assistant needs
authoring scaffolding: the platform tools (find capabilities, query workflows, commit a
revision), the Agenta authoring skill, and elevated sandbox permissions (write files, execute
code). That scaffolding is a build aid, not the user's agent. The shipped agent must carry only
what the user authored.

So the build kit is shown and used in the playground, never committed, and never reaches a
deployed run. This design decides who shows it, who applies it, and who keeps it out of the
commit.

## The model: a build-kit overlay

The build kit is an **agent-template overlay**: a partial agent template, the same shape as
`parameters.agent`. The platform owns it. The backend serves it read-only on the inspect
response. The frontend applies it to a playground run and leaves it out of a commit.

Three actors, three jobs:

- **The agent service runs the template it receives.** It reads `parameters.agent` and runs it.
  It does not know the build kit exists. There is no run-prep merge and no run flag. The
  platform tools, the authoring skill, and the build permissions reach a run only because they
  are already inside the `parameters.agent` the service was handed, and the service resolves
  them the way it resolves any tool, skill, or sandbox setting.
- **The backend serves the overlay.** It assembles the overlay once and attaches it to the
  inspect response. It never applies the overlay and never acts on it.
- **The frontend applies the overlay.** It reads the overlay from the inspect response and
  renders it read-only in the drawer. On a kit-on run, it merges the overlay onto the current
  `parameters.agent` and sends the result. On commit, it does not merge, so the committed
  config holds only the user's own template.

"Shown but not committed" follows from where the overlay lives and when the frontend applies it.
The overlay never enters `parameters.agent`, the tree the playground edits and commits. It lives
in the read-only inspect response and, on a kit-on run, in a throwaway merged copy that feeds the
run payload. A deployed agent runs its stored config, which has no overlay, so authoring power
cannot reach a published run.

## The overlay shape

The overlay is a partial `parameters.agent`. It can carry any agent-template field: tools,
embedded skills, sandbox or permission overrides, a model choice, instructions, or anything the
template defines later. One mechanism covers every kind. There are no per-kind groups and no
display fields to invent, because the overlay reuses the agent-template shape the platform
already defines and the playground already renders.

Skills in the overlay are ordinary `@ag.embed` references, full stop. An embed reference (the
slug, plus a version when pinned) is the platform's existing mechanism for embedding a variant,
and it already identifies the skill, which carries its own name and description. The overlay adds
no parallel `key`, `name`, or `description` for a skill. The authoring skill is the reserved
static skill `__ag__getting_started_with_agenta`
(`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`), served
read-only under the reserved `__ag__*` namespace.

Today's overlay:

```jsonc
{
  "agent_template_overlay": {
    "tools": [
      { "type": "platform", "op": "find_capabilities" },
      { "type": "platform", "op": "query_workflows" },
      { "type": "platform", "op": "commit_revision" },
      // a client/embed tool: a non-runnable reference to a reserved-slug workflow the frontend handles (#4920)
      { "type": "reference", "slug": "__ag__request_connection" }
    ],
    "skills": [
      { "@ag.embed": { "@ag.references": { "workflow": { "slug": "__ag__getting_started_with_agenta" } } } }
    ],
    "sandbox": {
      "permissions": { "write_files": "allow", "execute_code": "allow" }
    }
  }
}
```

The backend assembles `tools` from two parallel iterations, both over sources the platform
already owns. It iterates `PLATFORM_OPS`
(`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/platform/op_catalog.py`) for the
platform ops, so a new op added by the builder-tools project joins the kit with no edit here. It
also enumerates the reserved-slug platform workflows from the static workflow catalog
(`StaticWorkflowCatalog` over `_STATIC_WORKFLOWS` at
`/home/mahmoud/code/agenta/api/oss/src/core/workflows/static_catalog.py`) and adds each as a
reference (workflow-as-tool) entry. These reserved workflows are the same `__ag__*` family as the
platform skills, so a client tool like `__ag__request_connection` (the non-runnable connection
tool the frontend handles, owned by `#4920`) rides the kit beside the platform ops with no bespoke
path. The two iterations are symmetric: one walks the op catalog, the other walks the static
workflow catalog. `skills` is the `@ag.embed` reference to the authoring skill's reserved slug;
`sandbox` is the build-permission elevation. Each entry is an ordinary agent-template fragment, so
the dumb service resolves it the way it resolves any tool, skill, or sandbox setting, and a kit-on
run is indistinguishable on the wire from a config the user authored by hand with the same items.

## Where the overlay lives in the inspect response

The overlay is platform-owned, read-only, and derived per response. It is not user config and
not user metadata, so it does not belong in either of those contracts. It rides a dedicated
read-only container on the inspect response envelope.

```jsonc
{
  "count": 1,
  "application": { /* ... the agent, including data.parameters (the user's config) ... */ },
  "additional_context": {
    "playground_build_kit": {
      "agent_template_overlay": { /* the partial parameters.agent above */ }
    }
  }
}
```

- `additional_context` is a new optional field on `SimpleApplicationResponse`
  (`/home/mahmoud/code/agenta/api/oss/src/apis/fastapi/applications/models.py`), a sibling of
  `application`. It holds platform-supplied, read-only information derived for this response. The
  build kit is its first member; future read-only hints or pointers add new members beside
  `playground_build_kit` rather than overloading user-owned fields.
- `playground_build_kit` holds the kit's payload. Today that is one field, `agent_template_overlay`.
- `agent_template_overlay` is the partial agent template the frontend merges. The name says
  exactly what it is and how it is used, and it cannot be mistaken for the saved template.

This placement is the load-bearing decision, and it follows ownership and lifecycle:

- User config that the revision persists and the deployment runs lives in
  `application.data.parameters`.
- User metadata that round-trips through create, edit, and commit lives in `application.meta`.
- Platform information that the backend derives read-only for one inspect response lives in
  `additional_context`.

The overlay must not sit in `revision.data`. That object is the user's schema-constrained config,
it is `extra="forbid"`
(`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/models/workflows.py`), and it flows into the
commit and edit paths. The overlay must not sit in `application.meta` either, because that field
is user-owned and persisted. Both would blur the ownership line the rest of this design depends
on.

## Applying the overlay

A kit-on run produces a derived run config by merging the overlay onto a copy of the current
`parameters.agent`. The merge is an override overlay: the overlay adds entries the config lacks
and overrides entries it already holds.

- **Object fields** (`sandbox`, `runner`, `harness`, `llm`, `instructions`) deep-merge, and the
  overlay wins on a conflict. So `sandbox.permissions.write_files: "allow"` elevates the run's
  sandbox without discarding the user's other sandbox settings.
- **List fields** (`tools`, `skills`, `mcps`) merge by item identity. A tool's identity is its
  `op` for a platform tool, the referenced workflow for a reference (non-runnable workflow) tool,
  otherwise its `name`; a skill's identity is the slug its `@ag.embed` references; an MCP server's
  identity is its `name`. On an identity match the overlay entry
  overrides; otherwise it appends. So the kit's three platform ops and one authoring skill add to
  whatever the user authored, and re-adding an op the user already has is a no-op rather than a
  duplicate.

The merge runs on a throwaway copy in the run-build path only. It never mutates the draft or the
committed tree. A separate, explicit applier owns this, because the frontend's general config
merge is shallow and array-replacing; a naive spread would clobber the user's `tools` or `skills`
arrays. The applier lives beside the run builder (next section), not in the shared config-merge
path.

## Frontend behavior

The frontend owns three behaviors. All read the same overlay; none change the run wire.

1. **Read.** On loading the workflow, the frontend reads
   `additional_context.playground_build_kit.agent_template_overlay` from the inspect response and keeps it in
   session-scoped state, keyed like the existing inspect cache (per service), separate from the
   persisted `data`. It renders the overlay in the drawer. It hardcodes no item list and no
   labels.

2. **Apply on a kit-on run.** The drawer holds one piece of session state, `buildKitEnabled`,
   default on. When the frontend builds a run request, it applies the overlay if the toggle is
   on. The build point is `buildAgentRequest`
   (`/home/mahmoud/code/agenta/web/packages/agenta-playground/src/state/execution/agentRequest.ts`),
   which composes the `/invoke` body's `data.parameters` from the draft-aware config. With the
   kit on, the applier merges the overlay into the run copy's `parameters.agent` (object fields
   deep-merged, list fields identity-merged) and sends that. With the kit off, it sends the
   user's config unchanged, so the user previews the agent as users will see it. The builder
   already transforms `parameters` on a throwaway copy before sending (it drops half-filled
   entries and normalizes tool shapes), so the overlay merge is the same kind of pre-send step.

3. **Exclude on commit.** The commit path reads the user's config from
   `entity.data.parameters` through `prepareCommitParameters`
   (`/home/mahmoud/code/agenta/web/packages/agenta-entities/src/workflow/state/commit.ts`). The
   overlay was never written into `entity.data.parameters`, so the commit excludes it with no
   strip step. The inspect response and the kit-on run payload are the only places the overlay
   ever appears.

The run wire stays byte-compatible. The backend cannot tell a kit-on run from a hand-authored
config with the same items, and it does not need to.

## The drawer UI

This design covers both the inspect contract and the advanced-drawer UI, in one document. The UI
recomposes existing drawer parts. The designer handoff
(`/home/mahmoud/code/agenta/design_handoff_advanced_build_kit/README.md`) is the high-fidelity
spec; the `.dc.html` is a visual reference, not code, and `support.js` is mock runtime to ignore.

### The drawer today

Verified on this branch, so the changes land on real structure.

- The advanced drawer is `AgentTemplateControl.tsx`
  (`/home/mahmoud/code/agenta/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx`),
  rendered inside the `SectionDrawer` shell (icon, title, scroll body, Cancel and Save).
- The advanced body stacks three groups, separated by top borders, not yet collapsible:
  Authentication (`:1517`), Execution environment (`:1530`), and Permissions (`:1565`). These
  configure the committed agent.
- The collapsed-header summary the drawer computes (`advancedSummary`, `:1501`) reads values such
  as `Agenta-managed` and `Sandbox: Local` from existing state.
- `SkillTemplateControl.tsx:205` already renders an Agenta-owned skill read-only ("Provided by
  Agenta. This skill cannot be edited or removed"), with no editor and no delete. This is the
  read-only pattern the kit reuses.

### Change 1: make the advanced sections collapsible

Each advanced group becomes a collapsible accordion item, the behavior the playground's left
panel already uses, so the groups stop rendering as one long scroll.

- Default state is collapsed. Several sections can be open at once; it is not single-open.
- The header row shows the section icon, the title, a one-line summary on the right, then a
  chevron that rotates when open.
- The body mounts only when expanded. Its content is the section's existing controls, unchanged.
- Summaries reuse state already present: Authentication shows `Agenta-managed`, Execution
  environment shows `Sandbox: Local`, Permissions shows `Auto`.

This change carries no contract and no commit logic. It is drawer polish on the existing groups
and can ship on its own (open question 4).

### Change 2: add the "Playground build kit" section

A new collapsible section at the top of the drawer, above Authentication, with a subtly warmer
background (`#fcfcfa`) so it reads as a distinct playground-only layer.

- **Header**: a wrench icon, the title `Playground build kit`, a restrained `Removed on commit`
  tag (a small amber dot plus text, no pill, no banner), an enable or disable toggle, and the
  chevron. The toggle's click stops propagation, so flipping the kit does not also expand the
  section.
- **Body, when expanded**: an intro paragraph that ends with "None of this is part of the
  published agent." When the kit is off, an info note that the assistant can no longer create
  files, run code, or edit the agent here. Then the overlay, rendered read-only.

The drawer renders the overlay by reusing the playground's existing config-item controls, the
same way it renders the committed config. An `@ag.embed` skill renders as an embedded skill
(read-only, the pattern from `SkillTemplateControl.tsx:205`); a platform tool renders as a
platform tool; the `sandbox.permissions` fragment renders in a permissions group. The drawer
derives the handoff's three labelled groups from the overlay's own `skills`, `tools`, and
`sandbox.permissions`. A permission's green `On` pill reflects its value in the overlay (`allow`),
so the overlay needs no separate status field. Every row is dimmed and locked. The drawer
hardcodes no item list; it renders whatever the overlay carries. The designer's sample rows are
illustrative.

### The toggle wiring

The toggle does not set a run flag. It is `buildKitEnabled`, session state, default on. The
frontend reads it when it builds the run request and applies the overlay when it is on (frontend
behavior, step 2). The drawer writes nothing into the config and never echoes the overlay. The
toggle is a playground preference, not a field on the revision.

### Keep two permission ideas distinct

The drawer holds two things that both say "permissions," and they must not read as one setting.

- The committed Permissions group and the Execution environment group configure the agent's own
  permissions and sandbox. The user edits them, they commit, they ship.
- The build kit's permissions are a read-only reflection of the sandbox elevation the overlay
  carries. They are dimmed, locked, tagged removed on commit, and never committed.

The structure does the heavy lifting: the kit's permissions live inside the kit section, behind
the same dimming, lock, and removed-on-commit tag as the rest of the kit, while the agent's own
Permissions group stays an editable, committed control elsewhere. Review this with the designer,
because the two ideas sit close together and a user who conflates them could believe the agent
ships with write-files and execute-code permission.

## Published default stays bare

A new agent's stored config is bare: no platform tools, no authoring skill, no elevated sandbox.
Those three belong to the overlay now, not to the published default.

Today `schemas.py` enriches the published default with the authoring skill and the sandbox
boundary (`build_agent_v0_default(skill_slug=..., include_sandbox_permission=True)` at
`/home/mahmoud/code/agenta/services/oss/src/agent/schemas.py`). Revert that enrichment so the
inspect schema default and the catalog template both carry the bare default, the same value the
SDK builtin carries. The skill and the sandbox elevation reach a run only through the overlay, by
the frontend's merge.

The authoring skill also stops reaching runs through the harness force. Today the `pi_agenta`
harness unions `AGENTA_FORCED_SKILLS` into every run, always on and not toggleable
(`/home/mahmoud/code/agenta/sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:104`,
`harnesses.py:140`). A forced skill cannot be toggled, which contradicts the kit's toggle. So the
authoring skill comes from the overlay, not the force. Set `AGENTA_FORCED_SKILLS = []`, keeping
`force_skills` for a future genuinely-forced item. This touches the skills project's surface, so
confirm it with them (open question 2).

## What the backend explicitly does NOT do

State the negatives so no implementer re-adds them.

- **No service-side merge.** The agent service does not merge the overlay into the config at
  run-prep. There is no overlay merge in the agent app
  (`/home/mahmoud/code/agenta/services/oss/src/agent/app.py`). The service runs `parameters.agent`
  as received.
- **No run flag.** There is no inject flag on the run request and none on
  `WorkflowInvokeRequestFlags`. The toggle is client session state. The run wire gains no field.
- **The service does not read the overlay.** The overlay is assembled by the inspect layer and
  consumed by the frontend. The service's run path never references it.
- **No backend strip on commit.** The backend does not remove kit items from a committed config,
  because the kit never enters the committed config.

## Interface notes (design-interfaces)

The model rests on role splits, not feature splits.

- **Platform-derived information versus user-owned data.** `additional_context` is platform-supplied,
  read-only, and derived per response. `application.data.parameters` is user config the revision
  persists; `application.meta` is user metadata that round-trips. Three owners, three lifecycles,
  three homes. This split is why the overlay needs no strip step and cannot leak into a commit.
- **One overlay, not three typed groups.** The kit is a partial agent template, so it reuses the
  agent-template shape the platform already defines and the playground already renders. The kind
  of each item (tool, skill, permission) is implicit in where it sits in the template, not in a
  bespoke descriptor field.
- **A skill is its embed reference.** An `@ag.embed` reference already identifies a skill and
  carries its name and description. The overlay adds no parallel display fields for it.
- **A permission's status is its value.** A sandbox permission set to `allow` in the overlay is
  the status the drawer renders. No separate status field.
- **Session preference versus persisted config.** The toggle is a playground preference in client
  session state, not a field on the revision and not a flag on the run.

## Change set, by layer

1. **Additional-context container (backend, new).** Add `additional_context` to
   `SimpleApplicationResponse` with a typed `playground_build_kit.agent_template_overlay`
   (`/home/mahmoud/code/agenta/api/oss/src/apis/fastapi/applications/models.py`). Populate it only
   in the read path (`fetch_simple_application`), never in create, edit, or commit.

2. **Overlay builder (backend, new).** One builder assembles the overlay: `tools` from both
   `PLATFORM_OPS` and the reserved-slug platform workflows in the static workflow catalog, `skills`
   as the `@ag.embed` reference to the authoring slug, `sandbox` as the build-permission
   elevation. It reads platform-owned sources and is not referenced by the service run
   path.

3. **Published default goes bare (backend).** Revert the `schemas.py` enrichment so the schema
   default is bare. Move the authoring skill and the sandbox elevation into the overlay.

4. **Stop force-injecting the skill (SDK).** Set `AGENTA_FORCED_SKILLS = []`
   (`agenta_builtins.py:104`). Coordinate with the skills project.

5. **Frontend read and render (web).** Read `additional_context.playground_build_kit.agent_template_overlay`
   into session state. Render the "Playground build kit" section, reusing the existing config-item
   controls, and make the advanced sections collapsible.

6. **Frontend overlay applier (web).** Add an explicit applier (deep-merge objects, identity-merge
   lists) and call it in `buildAgentRequest` when the toggle is on, on the throwaway run copy
   only.

7. **Frontend exclude on commit (web).** No change beyond confirming the overlay is never written
   into `entity.data.parameters`, so `prepareCommitParameters` excludes it for free.

8. **Tests.** Backend: the builder lists the platform ops, the authoring skill, and the build
   permissions as one overlay; the inspect response carries `additional_context.playground_build_kit`; the
   published default is bare across the builtin, the inspect schema, and the catalog (update
   `/home/mahmoud/code/agenta/services/oss/tests/pytest/unit/agent/test_default_agent_template.py`).
   Frontend: a kit-on run merges the overlay into `parameters.agent` (deep-merge and identity-merge
   verified); a kit-off run sends the bare config; a commit excludes the kit either way; the
   applier never mutates the draft or committed tree.

## Risks and edge cases

- **Safety.** The kit grants self-commit, write files, and execute code. It cannot reach a
  production run: nothing persists it and the run path never adds it. A deployed agent runs its
  stored config, which has no overlay. Assert it (a published agent's resolved config never
  contains the platform ops or the elevated sandbox).
- **No new attack surface.** The run API already accepts and resolves whatever tools and
  permissions a config carries; a hand-authored config with the platform ops already runs them
  today. The overlay grants the frontend no new capability; it only saves the user from authoring
  those entries by hand.
- **Merge precedence.** The applier must deep-merge objects and identity-merge lists, not spread.
  A shallow spread would replace the user's `tools` or `skills` arrays. This is the one place a
  naive implementation breaks the feature.
- **Kit off.** A kit-off run uses the user's config only, so the user tests the agent as users
  will see it.
- **Existing agents.** They gain the kit in the playground with no migration, because the
  frontend merges it from the overlay at run time. Nothing is baked, so nothing goes stale.

## Out of scope and coordination

- The authoring skill's content and naming are owned by the skills project (`#4918`). This design
  references the skill by its reserved slug.
- The builder-tools project (`#4919`) adds more platform ops. The builder reads `PLATFORM_OPS` at
  assembly time, so new ops join the overlay automatically.
- A client tool such as `request_connection` is not a platform op. It is a non-runnable
  workflow (reference) tool: the backend exposes it and the frontend handles the call, the same
  reference-tool concept the platform already has. The kit carries it as a reference-tool entry,
  embedded from its reserved `__ag__*` slug (identity by its referenced workflow), beside the
  platform ops. Its primary definition is owned by `#4920`.
- Per-item edit or delete of kit items, and a picker to add platform tools to the published agent,
  are out of scope. The kit is whole-toggle and read-only in v1.
- The overlay model carries through to `#4918`, `#4919`, and `#4920`. They are not edited here; the
  orchestrator propagates it after Mahmoud approves this design.

## Open questions for Mahmoud

1. **Toggle persistence.** Ephemeral per playground session (resets to on), or a stored playground
   preference per user and agent. I lean ephemeral for v1.
2. **Confirm the published default goes fully bare**, dropping the authoring skill and the sandbox
   boundary from the schema default into the overlay, and setting `AGENTA_FORCED_SKILLS = []`. This
   touches the skills project's surface, so it needs their nod.
3. **Merge precedence on a conflict.** The overlay overrides on an identity match (it is an
   override overlay). Confirm the kit should win over a user entry of the same identity, rather
   than yield to it.
4. **Ship Change 1 (collapsible sections) with the kit, or separately?** It is independent UI
   polish with no contract and no logic. I lean separate.

## Appendix: prior approaches

Two earlier models were considered and dropped. The first had the agent service merge the kit at
run time behind a run flag; it put business logic in the service and a kit-injecting path on every
run. The second kept the merge on the frontend but modeled the kit as a bespoke descriptor with
three typed groups, each row carrying `key`, `name`, `description`, and a per-row `config`; it
reinvented display fields the agent-template shape and the embed reference already provide. The
current overlay model supersedes both: the service stays dumb, and the kit is one partial agent
template the frontend merges.
