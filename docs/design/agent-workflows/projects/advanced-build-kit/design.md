# Design: the advanced build kit (presentation layer)

Status: draft for Mahmoud's review. Grounded in code on `gitbutler/edit` over `big-agents`,
2026-06-28. Paths are absolute.

This is the Phase 2 presentation layer. It designs how the playground's advanced drawer shows
the build kit that `default-agent-config` injects. It consumes the inject-not-commit model; it
does not redesign it.

## Scope and the seam to default-config

Two projects share one seam.

- `default-agent-config` owns the business logic: WHAT goes in the build kit, that the run
  injects it, and that the commit never writes it. That design is final.
- This project owns the presentation: HOW the drawer shows the injected kit. It renders the kit
  read-only, in its own section, marked as removed on commit.

This layer consumes exactly two things from `default-agent-config`, both final: a read-only
descriptor of the kit (`revision.data.build_kit` in the `/inspect` response) and a per-run flag
(`flags.inject_build_kit`) that the drawer's toggle sets. Section 3 covers the contract. The
rest of this document is the drawer.

## 1. The problem

A new agent loads a set of platform tools, skills, and permissions so the assistant can build
the agent inside the playground. The drawer has to show those items somewhere. The obvious move
is to drop them into the existing Tools and Skills sections next to the user's own items. That
move is wrong on two counts.

- It hides ownership. The user can no longer tell which tools are theirs and which are Agenta's
  authoring scaffolding.
- It implies the scaffolding ships. The deployed agent runs without the kit, so listing it
  beside the committed config misrepresents what the user is building.

The build kit is authoring scaffolding. The user does not own it, cannot edit it, and never
ships it. So the playground shows it as a separate, read-only layer that says, plainly, that it
is removed on commit. The whole of this design follows from that one requirement.

## 2. The core model: displayed state versus committed state

This is the heart of the design, and it is an interface question, so apply design-interfaces.

The playground holds two states. They look adjacent on screen, but they answer different
questions and they must not share a contract.

- **Committed state** is `parameters.agent`: the user-authored agent. Its tools, skills,
  instructions, model, and the agent's own permissions. The user owns it. The revision persists
  it and the deployment runs it.
- **Displayed state** is what the playground shows during a build session: the committed state
  plus the injected build kit. The platform owns the kit. Nothing persists it.

Put through the role test, the build kit is a read-only descriptor: metadata for display,
platform-owned, scoped to the session rather than the revision. The design-interfaces rule
follows directly. A display concern does not belong in the persisted, user-owned contract. So
the descriptor is a **sibling of the config, never a member of `parameters.agent`**.

That single placement decision earns "shown but not committed" for free.

- It is shown because the backend hands the drawer a descriptor to render.
- It is not committed because it was never inside the config the drawer commits. There is no
  strip step to write, and none to get wrong.

The frontend already runs a strip at the commit boundary: `prepareCommitParameters` in
`commit.ts`
(`/home/mahmoud/code/agenta/web/packages/agenta-entities/src/workflow/state/commit.ts:68`)
calls `stripAgentaMetadataDeep` to drop the UI-only `agenta_metadata` field before commit. The
build kit deliberately needs none of that machinery, because it never enters the committed tree.
If a future implementer is tempted to merge the descriptor into `parameters.agent` so the
existing list controls can render it, this section is the reason not to: that move would inject
platform scaffolding into the user's committed contract and force a fragile strip on every commit.

## 3. The contract this layer consumes (final, owned by default-config)

`default-agent-config` defines and serves both fields. This layer only reads them. They are
restated here because the drawer's behavior is pinned to their exact shape.

### The descriptor

Delivered in the `/inspect` response at `revision.data.build_kit`, a read-only sibling of
`revision.data.schemas`. The frontend already fetches `/inspect` per workflow, so the drawer
reads the descriptor with no new request.

```jsonc
{
  "build_kit": {
    "skills":      [ { "key": "...", "name": "...", "description": "..." } ],
    "tools":       [ { "key": "...", "name": "...", "description": "..." } ],
    "permissions": [ { "key": "...", "name": "...", "description": "...", "status": "on" } ]
  }
}
```

Role analysis, field by field:

- The descriptor as a whole is display metadata, platform-owned and session-scoped. It is a
  sibling of the agent config, never part of `parameters.agent`.
- `skills` / `tools` / `permissions` are routing for layout. Each kind renders as its own
  labelled group, in that order, because the three kinds differ in exactly one way: a permission
  row carries a status the others do not.
- `key` is a stable, platform-owned routing key (the skill slug, the platform op, or the
  permission key). The drawer keys rows on it; it is not the visible label.
- `name` and `description` are display metadata: the row's label and its one-line purpose.
- `status` (permission rows only) is read-only policy state (`on` / `off`). It reflects what the
  kit grants for authoring. The drawer renders it as the green `On` pill. Skill and tool rows
  carry no status.

No field plays two roles, the kind tag is implicit in the array a row sits in, and the labels
are the backend's to own. The shape is sound as delivered; this layer adopts it unchanged.

### The flag

`flags.inject_build_kit` (boolean), on the run request, request-scoped. It is per-run policy,
not config on the revision, so it never enters `parameters.agent` and never commits. It defaults
to off server-side, so any non-playground caller runs the bare agent. The drawer defaults its
toggle on, so a normal playground run sends `true`.

The two names pair on purpose. `build_kit` is the read-only catalog of what the toggle controls;
`inject_build_kit` is the toggle. They ride different messages, the inspect response and the run
request, so they never appear together and cannot be confused for one field.

## 4. What the drawer looks like today

Verified in code on this branch, so the two changes land on real structure.

- The advanced drawer is `AgentTemplateControl.tsx`
  (`/home/mahmoud/code/agenta/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx`).
  An `openSection` state opens it inside the `SectionDrawer` shell (`.../SectionDrawer.tsx`,
  pure chrome: icon, title, scroll body, Cancel/Save).
- The advanced body already renders three stacked groups, separated by top borders, not yet
  collapsible: **Authentication** (`Key` icon, `AgentTemplateControl.tsx:1517`), **Execution
  environment** (`Cube` icon, `:1530`), and **Permissions** (`ShieldCheck` icon, `:1565`). These
  configure the committed agent.
- The collapsed-header summary the drawer already computes (`advancedSummary`, `:1501`) reads
  `Agenta-managed · Sandbox: Local` from existing state. Change 1 reuses the same state values
  for the per-section summaries.
- `SkillTemplateControl.tsx:205` already renders an Agenta-owned skill read-only:
  `Provided by Agenta. This skill cannot be edited or removed`, with no editor and no delete.
  This is the exact read-only pattern the kit reuses, lifted from the per-item list into the kit
  section.

So both changes extend a drawer that already has accordion sections, header summaries, and a
read-only Agenta-owned item pattern. Nothing here is novel; it is recomposition.

## 5. The two drawer changes (from the designer handoff)

The handoff (`/home/mahmoud/code/agenta/design_handoff_advanced_build_kit/README.md`) is a
high-fidelity spec covering two changes and nothing else. The `.dc.html` is a visual reference,
not code to copy; `support.js` is mock runtime to ignore.

### Change 1: make the advanced sections collapsible

Each advanced group becomes a collapsible accordion item, the behavior the playground's left
panel already uses, so the three groups stop rendering as one long scroll.

- Default state is collapsed. Several sections can be open at once; it is not single-open.
- The header row shows the section icon, the title, a one-line summary of the current value on
  the right, then a chevron that rotates when open.
- The body mounts only when expanded. Its content is the section's existing controls, unchanged.
- Summaries reuse values already in state: Authentication shows `Agenta-managed`, Execution
  environment shows `Sandbox: Local`, Permissions shows `Auto`. The build kit shows no text
  summary; its toggle sits in the header instead.

This change carries no contract and no commit logic. It is pure drawer polish on Arda's existing
groups, and it can ship on its own (open question 4).

### Change 2: add the "Playground build kit" section

A new collapsible section at the top of the drawer, above Authentication, with a subtly warmer
background (`#fcfcfa`) so it reads as a distinct playground-only layer.

- **Header**: a wrench icon, the title `Playground build kit`, a restrained `Removed on commit`
  tag (a small amber dot plus text, no pill, no banner), an enable/disable toggle, and the
  chevron. The toggle's click stops propagation so flipping the kit does not also expand the
  section.
- **Body, when expanded**: an intro paragraph that ends with `None of this is part of the
  published agent`. When the kit is off, an info note that the assistant can no longer create
  files, run code, or edit the agent here. Then the three groups.

**Rendering the descriptor, read-only.** The drawer renders the three groups straight from
`build_kit` (section 3), one labelled group per kind, in order. It hardcodes no item list. Every
row is dimmed and locked, reusing the read-only pattern from `SkillTemplateControl.tsx:205`.
Permission rows additionally render the green `On` pill from each row's `status`. The designer's
sample items (`agenta_authoring`, `commit_version`, `Write files`) are illustrative; the backend
owns the real set and labels, and the drawer renders whatever it receives.

**Wiring the toggle.** The enable/disable toggle is the only interactive control in the section,
and it sets one thing: `flags.inject_build_kit` on the next run request. On, the run injects the
kit and the assistant can build. Off, the run uses the bare agent, so the user previews the agent
as users will see it. The drawer holds the toggle as session state, default on, and sends it with
the run. It writes nothing back into the config and never echoes the descriptor.

## 6. Design review: keep two permission ideas distinct

The advanced drawer now holds two different things that both say "permissions", and they must not
read as one setting.

- The committed **Permissions** group (and the **Execution environment** group) configure the
  agent's own permissions and sandbox. The user edits them; they commit; they ship.
- The build kit's **PERMISSIONS** group is a read-only reflection of the build permissions the
  kit grants for authoring. It is dimmed, locked, tagged removed on commit, and never committed.

The structural separation does the heavy lifting: the kit's permissions live inside the kit
section, behind the same dimming, lock, and removed-on-commit tag as the rest of the kit, while
the agent's own Permissions group stays an editable, committed control elsewhere in the drawer.
The intro paragraph and the tag carry the distinction in words. This is worth a deliberate design
review with the designer, because the two ideas sit close together and a user who conflates them
could believe the agent ships with write-files and execute-code permission.

## 7. The split: us versus Arda

This project is almost entirely Arda's frontend work. The backend pieces it depends on are owned
and built in `default-agent-config`, not here.

**Arda (frontend):**

- Change 1: the collapsible advanced sections, reusing the existing accordion primitive.
- Change 2: the build-kit section header, the removed-on-commit tag, the toggle, the read-only
  grouped rows, and the disabled-state note.
- Reading `build_kit` from the `/inspect` response and rendering it (section 5). No hardcoded
  list.
- Setting `flags.inject_build_kit` from the toggle on the run request (section 3).
- Reusing the read-only pattern from `SkillTemplateControl.tsx:205`, lifted into the kit section.

**Us (backend, via `default-agent-config`, referenced not owned here):**

- Serving the `build_kit` descriptor on `/inspect` (grouped items, labels, descriptions,
  permission status).
- Keeping the kit out of the committed config.
- Honoring `flags.inject_build_kit` so a kit-off run skips injection.

This document's own deliverable is the presentation design: the displayed-versus-committed model
(section 2), the exact way the drawer consumes the contract (sections 3 and 5), and the design
review flag (section 6).

## 8. Open questions for Mahmoud

1. **Permissions group: read-only, or independently flippable?** The kit's PERMISSIONS group
   reflects what the kit grants. Is it purely read-only (this design's reading), or should the
   user flip those build permissions off while keeping the rest of the kit on? The designer shows
   them read-only under a single kit-level toggle, which is the simpler model. **Lean read-only.**

2. **Toggle: session-only, or a saved preference?** Pure session state that resets to on every
   time the drawer opens, or a preference saved per user and agent? The handoff defaults it to on
   and treats it as local drawer state. A saved preference is more work and needs somewhere to
   store it. **Lean session-only for v1.**

3. **An in-chat signal when the kit is off?** With the kit off, the playground runs the bare
   agent. Beyond the drawer note, do we want a clear in-chat signal that the user is now testing
   the published agent rather than the build agent? Or is the drawer state enough? **Open; no
   strong lean.**

4. **Ship Change 1 with the kit, or separately?** The collapsible-sections change is independent
   UI polish with no contract and no logic. Ship it with the build kit, or land it on its own as a
   small drawer cleanup first? **Lean separate**, since it de-risks the larger change and unblocks
   nothing.

## 9. Interface notes (design-interfaces recap)

- The build kit is a read-only display descriptor: platform-owned, session-scoped, a sibling of
  the agent config, never a member of `parameters.agent`. This is the load-bearing separation:
  display state and platform scaffolding stay out of the persisted, user-owned contract, which
  gives "shown but not committed" with no strip step.
- Grouping by kind (`skills`, `tools`, `permissions`) is routing for layout. It matches the one
  real difference between kinds, the permission `status`. It is not a vague bucket.
- Every row carries a stable routing key (`key`) and display metadata (`name`, `description`).
  Permission rows add one read-only policy field (`status`). No field plays two roles.
- The toggle is per-run policy on the run request (`flags.inject_build_kit`), not config on the
  revision. It defaults off server-side and lives in session state on the client, so it cannot
  leak into a commit.
- The descriptor is read-only end to end. The frontend reads it, never writes it, never merges it
  into the config, and never echoes it back.
