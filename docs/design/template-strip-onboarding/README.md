# Template strip onboarding

One shared "template strip" component replaces the current template presentation on the
home page and in the playground. The strip is a fixed-height, horizontally paged row of
template cards with category tabs. Clicking a card fills the composer with the template's
message and attaches a provenance chip. The whole experience sits behind a new
environment flag; the current flows stay intact when the flag is off.

The high-fidelity design lives at `/home/mahmoud/code/agenta/design_handoff_template_strip`
(interactive HTML prototypes plus written notes). Light mode is final and should be
recreated pixel-perfectly with AntD + Tailwind. Dark mode needs deliberate token
translation, covered in `design.md`.

## Files

- `context.md` - why this work exists, goals, non-goals, owner decisions, flag matrix.
- `research.md` - verified findings from the design handoff and the existing codebase:
  what exists today, what the prototype specifies, what is uncommitted in the tree.
- `design.md` - the TemplateStrip component design (props, state, pager math, chip),
  per-surface integration, env-flag wiring, the hex-to-token mapping table with dark
  values, the copy action and toast, the Usage card restyle, and analytics parity.
- `plan.md` - implementation slices sized for Sonnet subagents, plus the dev-stack
  verification plan.
- `status.md` - current progress, blockers, and the open decisions list. Source of truth
  for where the project stands.

## Quick orientation

- Design handoff: `design_handoff_template_strip/` at the repo root
  (`Template Strip Prototype.dc.html` is the real component with template data and logic
  in a `text/x-dc` script block; `README.md` and
  `Template Strip - Implementation Notes.md` are the notes; `_ds/.../colors_and_type.css`
  is the token sheet).
- Template registry (reused as-is): `web/oss/src/components/pages/agent-home/assets/templates.ts`.
- Flag pattern to follow: `web/oss/src/components/pages/agent-home/assets/constants.ts`
  plus `web/oss/src/lib/helpers/dynamicEnv.ts`.
- Theme source of truth: `web/oss/src/styles/theme/palette.ts` (edit, then
  `pnpm generate:tailwind-tokens`; never hand-edit generated files).
