# Responsive Behavior

The design targets a **1440px** desktop canvas and reflows down to mobile. Below
is the intended behavior per page. Implement with **CSS media queries or
container queries** in production (see the standardization note at the end).

## Breakpoints (target these in production)

| Name | Width | Primary effect |
|---|---|---|
| Desktop | ≥ 1280px | full 1440-canvas layout (centered, max-width 1440) |
| Laptop | 1024–1279px | fluid; multi-column grids intact |
| Tablet | 768–1023px | nav → hamburger; 4-col grids → 2-col; CTA/article columns begin stacking |
| Mobile | < 768px | single column; tightened section padding; stacked CTA & footer |

> The current mocks use **two different mechanisms** (see note below): the Blog
> pages switch at a single `@media (max-width: 980px)`, while the Pricing page
> uses JS viewport breakpoints at 1440/1000/920/760/680. **Standardize on the
> table above** when you implement.

---

## Global chrome

**NavBar** — below ~980px: hide center links + right-side CTAs, show a hamburger
that toggles a slide-down panel containing all nav links and both CTAs
(full-width). Logo stays.

**CtaBand** — below ~900px: hide the decorative Agenta symbol; stack the text
block and buttons vertically; reduce section padding (~96px → ~64px). Buttons
wrap.

**Footer** — below ~980px: stack into a single column (brand block above the
link columns); reduce horizontal padding (172px → 24px); link columns wrap with
smaller gaps.

---

## Pricing (`/pricing`)

| Region | Desktop | Tablet | Mobile |
|---|---|---|---|
| Plan cards | 4 columns | 2 columns (<1000px) | 1 column (<680px) |
| Comparison table | full 5-col grid | **horizontal scroll**, min-width ~780px (the table never collapses — columns stay full size and the section scrolls sideways) | same horizontal scroll |
| Hero | 80px top padding | — | ~52px padding, smaller type |
| CTA symbol | shown | hidden (<900px) | hidden |
| Section padding | 112px | — | ~72px |

Billing toggle stays centered at all sizes. Price updates are instant on toggle.

## Blog index (`/blog`)

| Region | Desktop | Tablet/Mobile (<980px) |
|---|---|---|
| Featured row | big card + 388px secondary stack side by side | stacks: big card, then secondary cards full-width |
| "All blogs" grid | 3 columns | 1 column |
| Category filter | inline pill row | horizontally scrollable pill row |
| Section padding | 64px horizontal | 20px horizontal |

## Blog post (`/blog/[slug]`)

| Region | Desktop | Tablet/Mobile (<980px) |
|---|---|---|
| Article header | centered, max-width 760px | 24px side padding; h1 → ~34px |
| Hero image | 16:9, max-width 1016px | full-width, ~200px tall |
| Prose column | max-width 720px | 20px side padding; h2 → ~26px |
| "More from the blog" | 4-col grid | 1 column |
| Author byline | row (avatar · name/role · socials) | stacked, left-aligned |

---

## Standardization note (please read)

The two mechanisms in the mocks exist only because of the prototyping format:

- **Blog pages** use real CSS `@media` rules (in a `<style>` block) — this is the
  pattern to follow.
- **Pricing page** computes layout from `window.innerWidth` in JS. This was a
  prototyping convenience and is **not** how to ship it. In production, express
  all Pricing reflow with the same CSS media/container queries as the rest of the
  site. The *breakpoint intent* above is what matters; the JS implementation is
  not part of the contract.

When you rebuild, use one consistent system (CSS media queries, or container
queries if your layout is component-driven) across all pages.
