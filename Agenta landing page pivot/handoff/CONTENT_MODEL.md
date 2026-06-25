# Content Model — the CMS schema

This is the single most important doc for making future changes "automatic."
Pages render from data shaped exactly like the files in `../content/`. **Those
sample files _are_ the schema, by example.** When you wire a CMS, define
collections that produce these shapes. When the user "writes a blog post," they
add one `posts/<slug>.md` in this shape — design and CMS never drift because they
agreed on the shape here.

The schema is given **CMS-neutral**. Mapping notes for the two common styles:
- **Git/MDX** (Contentlayer, Velite, Astro content collections): frontmatter =
  the scalar fields; the markdown/MDX body = the rich `body` field.
- **Headless** (Sanity, Contentful, Payload): each collection below = a document
  type; `body` = portable text / rich text; refs = references.

> Decision needed from the implementing team: **MDX vs. portable-text** for rich
> bodies. It changes how authors write inline components (the in-article CTA
> card, callouts, code blocks). Flag your choice in feedback.

---

## Collection: `post` (blog)

Sample files: `../content/posts/*.md`. One file per article.

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | ✓ | URL slug; from filename if MDX. `/blog/[slug]`. |
| `title` | string | ✓ | GT Alpina headline. |
| `description` | string | ✓ | ~1–2 sentences. Used as excerpt on cards + meta description + OG. |
| `category` | enum | ✓ | One of `category` taxonomy (see below). Drives the filter pills + card thumb tint. |
| `date` | date | ✓ | Display format `MMM D, YYYY` (e.g. "Feb 11, 2026"). Store ISO; format in view. |
| `readingTime` | string \| computed | – | e.g. "8 min read". Can be auto-computed from body word count. |
| `heroImage` | image | – | 16:9. Falls back to a generated gradient + faded Agenta symbol when absent (see cards in the mocks). |
| `ogImage` | image | – | Defaults to `heroImage`, else `assets/blog/og-default.png`. |
| `author` | ref → `author` | ✓ | by slug. |
| `featured` | bool | – | The blog index shows 1 primary + 2 secondary featured. Either this flag (+ an order) or an editorial "featured" list in `site.json`. |
| `tags` | string[] | – | optional, not surfaced in current design. |
| `body` | rich text / MDX | ✓ | See "Body content" below. |

### `category` taxonomy
Currently `Engineering` and `Article`. The blog filter is `All` + the distinct
categories. Card thumbnail tint is derived from category:
- `Engineering` → `linear-gradient(150deg,#15181C,#101113)`
- `Article` → `linear-gradient(150deg,#211D1B,#131214)`
Keep this mapping in code (a small lookup), not in content.

### Body content (what the rich body must support)
From `Agenta Blog Post (Dark).dc.html`, the body uses: `h2`, `h3`, paragraphs,
**bold lead-ins**, unordered lists, `blockquote` (yellow left-border, italic GT
Alpina), inline `code` and code fences, and inline links (yellow, underlined).

It also contains **one inline CTA card** ("Ship reliable AI apps faster" →
Star on GitHub / Get started). Treat this as a **reusable embeddable block**, not
hand-written per post:
- MDX: an `<InlineCTA />` component authors can drop in (or auto-insert after the
  first H2).
- Portable text: a custom block type `inlineCta`.
Its default copy lives in `site.json → inlineCta` so it's edited once globally.

### Related posts
The post page shows "More from the blog" (4 cards). Derive these in code
(same-category, most recent, excluding current) rather than authoring per post.

---

## Collection: `author`

Sample: `../content/authors/mahmoud-mabrouk.json`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | ✓ | `/blog/author/[slug]`. |
| `name` | string | ✓ | |
| `role` | string | ✓ | e.g. "Co-Founder Agenta & LLM Engineering Expert". |
| `avatar` | image | ✓ | square; rendered as 56px circle in the byline. |
| `bio` | string | – | for the author page. |
| `socials` | array | – | `{ platform, url }`. Rendered as icon chips. |

---

## Collection / singleton: `pricing`

Sample: `../content/pricing.json`. The **entire pricing page** is data so plans
and the comparison table can change without touching layout.

```
pricing = {
  billing: { defaultCycle: "monthly", annualDiscountLabel: "−20%" },
  plans: Plan[],          // rendered as the 4 cards
  comparison: {
    columns: { name, priceMonthly, priceAnnual }[],   // table heads
    groups: { title, rows: { label, cells: Cell[] }[] }[]
  },
  faqs: { question, answer }[]
}

Plan = {
  id, name, popular: bool, tagline,
  priceMonthly: number|null,   // null ⇒ show `customPrice`
  priceAnnual:  number|null,   // per-month-billed-yearly
  customPrice: string|null,    // e.g. "Custom" / "$0"
  unitMonthly, unitAnnual,     // e.g. "/month", "/mo, billed yearly"
  cta: { label, style: "primary"|"outline" },
  includesLabel,               // "Everything in Pro, plus"
  features: string[]
}

Cell = boolean | string
  // true  ⇒ yellow check icon
  // false ⇒ dash (not included)
  // string ⇒ literal value ("5k", "1 year", "Custom", "Community")
```

> The numbers in the sample (`$49`/`$399`, trace/seat limits, retention) are
> **design placeholders**. Replace with Agenta's real plan data before launch —
> this is a known open item, flagged for the user.

---

## Singleton: `site` (globals)

Sample: `../content/site.json`. Shared chrome + bands so they're edited once.

```
site = {
  nav:    { links: { label, href, external? }[], cta: {...}, secondaryCta: {...} },
  footer: { blurb, socials: {platform,url}[], columns: { heading, links:{label,href}[] }[],
            copyright, legalLink },
  ctaBand:  { title, body, primary:{label,href}, secondary:{label,href} },
  inlineCta:{ title, body, primary:{label,href}, secondary:{label,href} }
}
```

---

## Field-naming rule

Keep these field names stable across CMS, code, and these docs. A rename is a
breaking change to the contract — if a field must change, change it in the
`content/` sample + this doc in the same edit so the design and the CMS move
together.
