# Component Inventory

Reusable UI pieces across the site, with props and where they're defined. The
**design system** already ships real React components for the core ones (in
`_ds/agenta-brand-<id>/components/`, namespace `AgentaDesignSystem_e4caef`). In
the mocks these are mounted via `<x-import component-from-global-scope="...">`.

**In production:** either port these design-system components into your codebase
1:1 (recommended — they encode the keycap shadows, gradients, and states
correctly), or rebuild them against the tokens in `TOKENS.md`. Don't restyle raw
HTML to merely *look* like them.

> Read the actual source for exact props:
> `_ds/agenta-brand-<id>/components/<area>/<Name>.jsx`.

---

## Design-system components (already defined)

| Component | Source | Purpose / key props |
|---|---|---|
| `Button` | `components/buttons/Button.jsx` | `variant`: primary (yellow keycap) · `dark` · `outline` · ghost. `size`: `sm`/`md`/`lg`. children = label. The site's main CTAs. |
| `Badge` | `components/buttons/Badge.jsx` | pill eyebrow/label. |
| `NavBar` | `components/marketing/NavBar.jsx` | top nav. |
| `SectionTitle` | `components/marketing/SectionTitle.jsx` | `badge` (eyebrow), `title` (GT Alpina), `subtitle`, `dark` flag. Used for Pricing's "Compare"/"FAQ" headers. |
| `HighlightChip` | `components/marketing/HighlightChip.jsx` | the PP Mondwest highlighted-word chip inside a headline. |
| `FAQItem` | `components/marketing/FAQItem.jsx` | one accordion row (GT Alpina 20px question). |
| `Footer` | `components/marketing/Footer.jsx` | site footer. |
| App-console set | `components/app/*` | `AppSidebar`, `SidebarItem`, `AppButton`, `ToolbarChip`, `PillTabs`, `SearchField` — product UI, **not** marketing. Only relevant if you also build the app console. |

---

## Page-composed components (built inline in the mocks — formalize these)

These aren't separate DS components yet but repeat across pages and should become
real components in your codebase. Measurements are in the source `.dc.html`.

### `SiteNav`
- Sticky-ready top bar, 68px tall, `#100F11`, hairline border.
- Left: logo (23px tall, links `/`). Center: nav links (active = `--yellow-400`).
  Right: `Book a demo` (outline) + `Get started` (yellow).
- **Mobile (<980px / <920px):** center links + right CTAs hide; a hamburger
  button toggles a slide-down menu listing all links + both CTAs full-width.
- Data: `site.json → nav`. Active state from current route.

### `CtaBand`
- Full-bleed yellow section. Left column: GT Alpina `--text-display-lg` heading
  (`--text-on-yellow`), body, two buttons (`dark` + `outline`). Right: faded
  Agenta symbol (`assets/logos/Agenta-symbol-light.svg`, opacity .16), **hidden
  <~900px**. Stacks vertically on mobile.
- Data: `site.json → ctaBand`.

### `SiteFooter`
- `#100F11`. Left: logo + blurb + 4 social chips (`assets/icons/social-1..4.svg`,
  inverted to white). Right: 4 link columns. Bottom bar: copyright + privacy.
- Data: `site.json → footer`.

### `PostCard`
- Blog card: tinted gradient thumb (height varies by placement: 300/168/160/108)
  with a faded Agenta symbol + a category pill bottom-left; then GT Alpina title,
  optional excerpt, date. Whole card is a link.
- Variants: **featured large** (vertical, 300px image), **secondary** (horizontal,
  116px thumb), **grid** (168px), **related** (160px). Same data, different layout.
- Props: `post` (see `CONTENT_MODEL → post`), `variant`.

### `CategoryFilter`
- Pill row on the blog index. Active pill = yellow (`--yellow-400` bg, ink text,
  keycap shadow); inactive = dark glassy. Options: `All` + distinct categories.
- Behavior: client-side filter of the post grid (no reload). State: selected
  category.

### `PlanCard` (pricing)
- Vertical card: name (GT Alpina), tagline, big price + unit, CTA, divider,
  "includes" label, feature list with yellow check icons. **Popular** variant
  has a yellow-tinted border/glow + a "Most popular" pill top-right.
- Props: `plan` (see `CONTENT_MODEL → Plan`), `billingCycle`.

### `BillingToggle` (pricing)
- Segmented Monthly / Annual control; Annual shows the `−20%` label. Switching
  updates every `PlanCard` price and the comparison column headers.
- State: `billingCycle` lifted to the pricing page; cards + table read it.

### `ComparisonTable` (pricing)
- 5-column grid (feature label + 4 plans). Grouped rows with a yellow group
  title. Cells render: yellow check (`true`), dash (`false`), or literal text.
- **Mobile:** horizontal scroll, min-width ~780px, so all plan columns stay
  full-size. See `RESPONSIVE.md`.
- Props: `comparison` (see `CONTENT_MODEL`), `billingCycle`.

### `ArticleBody` (blog post)
- Renders the rich body (MDX/portable text). Must style h2/h3 (GT Alpina),
  paragraphs (Inter 18/1.75), lists, `blockquote` (yellow left border, italic),
  inline `code` + code fences (Geist Mono, yellow), links (yellow underlined).
- Embeds: `InlineCTA` block (data from `site.json → inlineCta`).

### `AuthorByline`
- Avatar (56px circle) + name + role + social chips. Links to author page.
- Props: `author` (see `CONTENT_MODEL → author`).

---

## State summary (what needs client interactivity)
- `SiteNav` — `menuOpen` (mobile).
- `BillingToggle` / pricing page — `billingCycle` (`monthly`|`annual`).
- `CategoryFilter` / blog index — `selectedCategory`.
- Pricing FAQ + any accordion — `openIndex`.
Everything else is static / server-rendered.
