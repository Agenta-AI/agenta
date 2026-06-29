# Status: advanced build kit (presentation layer)

## What this project is

The presentation layer for the platform tools, skills, and permissions Agenta injects so the
assistant can build an agent inside the playground. This project owns HOW those items are shown
in the advanced drawer. It does not own what they are, how they are injected, or that they are
not committed.

Phase 2 add-on. It builds on the `default-agent-config` inject-not-commit model, which is now
final. This project consumes that model; it does not redesign it.

## Scope (matches the designer handoff)

In scope:

- The advanced drawer that displays the injected build kit, in its own section, instead of mixing
  it into the normal Tools and Skills sections.
- The two drawer changes from the handoff: collapsible advanced sections (Change 1) and the new
  "Playground build kit" section (Change 2).
- Rendering the `build_kit` descriptor read-only (the three groups, the permission `On` pill).
- Wiring the enable/disable toggle to `flags.inject_build_kit` so the user can preview the bare
  agent.

Out of scope (owned by `default-agent-config`):

- What gets injected, and the inject mechanism.
- That the injected items are not committed (the backend keeps them out of the config).
- Serving the descriptor and honoring the run flag.

## The seam to default-config

`default-agent-config` owns WHAT is injected and that it is not committed. This project owns HOW
it is shown. This layer consumes exactly two final fields from that project:

- `revision.data.build_kit` in the `/inspect` response: a read-only descriptor, grouped by kind
  (`skills`, `tools`, `permissions`), each row `key` / `name` / `description`, permission rows
  adding `status`.
- `flags.inject_build_kit` on the run request: the per-run toggle, default off server-side.

See `design.md` section 3 for the contract and section 5 for how the drawer consumes it.

## Where we are

- Designer handoff read in full (`/home/mahmoud/code/agenta/design_handoff_advanced_build_kit`),
  including the `.dc.html` visual reference.
- Drawer code mapped on this branch: `AgentTemplateControl.tsx` (the three advanced groups and
  the collapsed-header summary), `SectionDrawer.tsx`, the read-only pattern at
  `SkillTemplateControl.tsx:205`, and the commit strip in `commit.ts`.
- Design rewritten in `design.md` and aligned to the final inject-not-commit contract (the
  uniform `key` row shape and the `flags.inject_build_kit` flag).
- design-interfaces applied to the displayed-versus-committed model and the consumed contract.
- Four open questions for Mahmoud are in `design.md` section 8, each with a recommendation.

## Not yet

- This is a design doc, not a PR. No code is written.
- Open questions 1-4 await Mahmoud's call.
- The design review of the two permission ideas (`design.md` section 6) is pending with the
  designer.
