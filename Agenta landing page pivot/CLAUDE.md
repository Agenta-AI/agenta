# Project conventions — Agenta website

Persistent rules for any agent working in this project. Read before editing.

## What this project is

The **design source-of-truth** for the Agenta marketing website. Pages are built
as Design Components (`*.dc.html`) using the bound **Agenta Brand** design system
(`_ds/agenta-brand-e4caef1d-4f02-4558-abd2-6342c89dde68/`). These are high-fidelity
design references that a separate engineering team reimplements in a production
codebase. They are **not** the production app.

## Two-track workflow

1. **Design track (here):** iterate on look, layout, copy, responsiveness as DCs.
2. **Implementation track (external):** rebuild in a real stack + CMS, consuming
   this project through the `handoff/` contract.

The bridge is the `handoff/` folder + `content/` samples. **Whenever a design
changes in a way that affects structure, content shape, tokens, components, or
responsive behavior, update the matching `handoff/*.md` and/or `content/*` file
in the same turn.** That is what keeps handoff near-automatic. Don't let the docs
drift from the designs.

## Visual rules (from the Agenta design system)

- Load the design-system bundle + token CSS in every DC's `<helmet>`. Style
  against `var(--*)` tokens — never invent colors or hexes.
- One yellow (`--yellow-400`) moment per viewport: primary action / CTA band /
  active state only.
- Type roles are strict: GT Alpina = display/headings, Inter = body/labels,
  PP Mondwest = a single highlighted word, Geist = product app only.
- Marketing section panels are square (hairline border, no radius); rounding is
  for interactive elements + cards.
- No emoji, no unicode-as-icon. Icons are 1.5px-stroke line SVGs (Lucide as a
  flagged substitute).
- The current site is the **dark** treatment; keep it theme-aware where practical.

## Content rules

- Real copy and structure live in the DCs + `content/`. Don't add filler
  sections or invented stats. Ask before adding new content/pages.
- Pricing numbers in `content/pricing.json` are **placeholders** pending real
  data from the user.

## Handoff docs index

- `handoff/README.md` — entry point + workflow
- `handoff/TOKENS.md` — colors/type/radii/shadows
- `handoff/SITEMAP.md` — pages, routes, source files
- `handoff/CONTENT_MODEL.md` — CMS schemas
- `handoff/COMPONENTS.md` — component inventory + props
- `handoff/RESPONSIVE.md` — breakpoints + reflow
