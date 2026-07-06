# Connect a Model drawer redesign

Planning workspace for redesigning the agent playground's "Model & harness" section
drawer after the claude.design prototype "Connect a Model Flow", with the product
owner's final decisions applied (three sections, a "Use API key" / "Use subscription"
credentials toggle, inline custom providers, an unsaved-changes guard, and a readable
selection style for the shared SectionRail).

Status: **planned, not implemented**. See status.md for open decisions.

## Files

| File | What it holds |
| --- | --- |
| [context.md](context.md) | Why the work exists, the owner's locked decisions, scope, and constraints (uncommitted in-flight changes, package layering, dark mode). Read this first. |
| [research.md](research.md) | Verified code map with file/line citations, the confirmed `--ag-colorPrimaryBg` root cause, SectionRail blast radius, the extracted design prototype, and the hex → theme-token mapping. |
| [design.md](design.md) | Component-level design: drawer structure, the SectionRail restyle, the ProviderCredentialsSection and its props, the CustomProviderForm extraction (with required package moves), the unsaved-changes guard, Advanced-tab removal, gating matrix, and final copy strings. |
| [plan.md](plan.md) | Six implementation slices sized for Sonnet subagents, in dependency order, plus the dev-stack verification plan (light + dark). |
| [status.md](status.md) | Source of truth for progress, the open decisions D1-D6, locked decisions, and next steps. Keep it updated. |

## Quick orientation

- Drawer host: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx`
- Stateful core: `.../SchemaControls/agentTemplate/useModelHarness.tsx`
- Shared rail: `web/packages/agenta-entity-ui/src/drawers/shared/SectionRail.tsx`
- Secrets: `web/packages/agenta-entities/src/secret/`
- Custom-provider form (extraction source): `web/oss/src/components/ModelRegistry/Drawers/ConfigureProviderDrawer/`
- Design prototype: `Agenta onboarding flow redesign (1)/Connect a Model Flow.dc.html`
