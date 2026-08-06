# Context

## Why

Agenta's "create your first agent" onboarding currently presents templates three
different ways:

1. Home page: a card grid (`TemplatesSection`), collapsible behind a "Browse templates"
   toggle for returning users, with a category dropdown.
2. Playground-native onboarding: a left-panel quick-pick list (`OnboardingConfigPanel`)
   plus a "Browse all templates" in-place gallery (`OnboardingBrowseTemplates`).
3. A standalone gallery page (`/agent-templates`).

Each surface behaves differently (drawer vs direct create vs in-place commit), the grid
causes layout shift when filtering, and the "Continue in IDE" path opens a modal that
interrupts the flow.

The redesign replaces all template presentation with ONE shared `<TemplateStrip />`:
always visible, scannable in a single fixed-height row, filterable in place with no
layout shift, and consistent across surfaces. Clicking a card no longer creates anything;
it fills the composer with the template's message and marks provenance with a chip. The
user edits, then explicitly hits "Create agent". The "Continue in IDE" modal becomes a
one-click "Use my coding agent" copy action with a toast.

## Design source

`/home/mahmoud/code/agenta/design_handoff_template_strip/`. The `.dc.html` files are
interactive design references, not production code. Fidelity is high: colors, spacing,
typography, radii, and interaction states are final for light mode and match the Agenta
design system. We recreate them with AntD 6 + Tailwind. Dark mode is not designed; we
translate every hex to `--ag-*` theme tokens and make explicit dark choices (see
`design.md`).

## Goals

- One shared TemplateStrip component used on three surfaces: home, playground-native
  onboarding, and every agent's empty-chat state.
- Card click fills the composer and shows a provenance chip; chip removal keeps the text.
- "Use my coding agent" copies an install command plus the composer text to the
  clipboard and confirms with a bottom-center toast. No modal.
- Playground surfaces get a "Don't show again" hide affordance persisted in
  localStorage; home never hides the strip.
- Home page gets the redesigned layout: hero, composer, strip, restyled one-line Usage
  card, "Your agents" table.
- Everything behind a new env flag. Flag off (default) is the CURRENT behavior, exactly.
  Nothing gets deleted.
- Analytics parity: the strip fires the same `first_agent_intent` events the current
  flows fire.
- Pixel-faithful light mode; deliberate, token-driven dark mode.

## Non-goals

- No backend or API changes. Templates stay the static frontend registry
  (`AGENT_TEMPLATES`, 6 templates).
- No new template content. The registry is reused as-is.
- No "browse all" destination in the new experience (the strip is the whole browsing
  surface). The existing gallery page stays reachable only under flag-off.
- No deletion or refactor of the parked flows (setup drawer, Continue-in-IDE modal,
  collapsible Browse templates, onboarding quick-pick list). They stay behind flag-off.
- No mobile-specific design work beyond the strip's native horizontal scrolling.

## Owner decisions (final, from the feature owner)

1. **Template data**: reuse the existing `AGENT_TEMPLATES` registry as-is
   (`web/oss/src/components/pages/agent-home/assets/templates.ts`). The card-click
   "message" comes from the existing message fields. Which field is our call to propose
   and flag (see `status.md` D1).
2. **Old flows parked behind an env flag**: new flag `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP`,
   read via `getEnv` following the `constants.ts` pattern. Default (unset) = current
   behavior exactly. Flag on = the new strip everywhere.
3. **Playground scope**: the strip appears on the playground-native onboarding surface
   AND on every agent's empty-chat state (that is why the hide affordance exists there).
   Per-surface behavior:
   - Onboarding: "Create agent" commits the ephemeral in place and auto-sends (existing
     commit path).
   - Agent empty chat: template click fills the chat composer with the message plus a
     chip; sending is a normal chat turn. There is no Create button on this surface (see
     `status.md` D2 for the actions-row reconciliation).
   - Home: create the agent, then navigate to the playground and auto-send (existing
     `autoSendSeed` path).
4. **CLI copy string**: `npx skills add Agenta-AI/agenta-skills` (the owner's corrected
   string, NOT the prototype's `npx agenta skills install agenta-ai/agenta`).

## Flag matrix (what renders where)

Three flags interact. `STRIP` = the new `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP`.
`ONBOARDING` = `NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING`.
`BUILDER` = `NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER`.

| Surface | STRIP off (default) | STRIP on |
| --- | --- | --- |
| Home, first run | Hero + composer (Continue in IDE + Create agent) + TemplatesSection grid; template click opens the setup drawer (or creates directly when BUILDER on) | Hero + composer (Use my coding agent + Create agent) + strip below composer; template click fills the composer + chip; Create navigates to the playground and auto-sends |
| Home, returning | Collapsible "Browse templates" + UsageSummary + YourAgentsTable | Same layout as first run, then restyled one-line Usage card + YourAgentsTable; strip always visible, no hide |
| Playground onboarding (needs ONBOARDING on) | Left quick-pick template list + right hero with starter chips; Continue in IDE streams a bubble | Centered hero + strip (with the hide menu) + composer with chip; left quick-pick list suppressed; "Use my coding agent" copies + toast |
| Agent empty chat | AgentChatEmptyState (build-mode card / starters / first-run prompt) | Strip above the composer with the hide menu; template click fills the chat composer + chip; sending is a normal turn |
| Gallery page `/agent-templates` | Reachable (Browse all) | Not linked from anywhere (route itself stays) |

`BUILDER` becomes irrelevant on strip surfaces: under STRIP on, a template click never
creates anything, so neither the drawer nor the builder-mode direct create runs. Both
remain untouched for flag-off.
