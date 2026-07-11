# Marketing website — QA report

Adversarial QA pass over the Astro marketing site running at `http://localhost:4321/`.
Each page loaded at **desktop 1440x900** and **mobile 390x844**. Captured full-page
screenshots, read console (error + warn), checked horizontal overflow, and actually
clicked/expanded every interactive island. Date: 2026-06-26.

Screenshots: `docs/design/marketing-website/research/qa-shots/`.
Known issues cross-checked against `docs/design/marketing-website/build-notes.md`.

## Pass / fail summary

| Page | Desktop 1440x900 | Mobile 390x844 |
|---|---|---|
| `/` (landing) | OK | OK |
| `/pricing` | OK | OK |
| `/blog` | ISSUE — category filter does nothing (F1) | ISSUE — same (F1) |
| `/blog/how-to-evaluate-rag-metrics-evals-and-best-practices` | OK | OK |
| `/blog/author/mahmoud-mabrouk` | OK | OK |
| `/blog/author` (authors index) | OK | OK |
| `/imprint` | OK | ISSUE — 28px horizontal overflow (F2) |
| `/terms` | OK | OK |
| `/contact` | OK | ISSUE — 28px horizontal overflow (F2) |

**Console: zero errors and zero warnings on every page, both viewports.**

Clean pages: 6 of 9 fully clean both viewports (landing, pricing, blog post, author,
authors index, terms). 3 pages carry issues: `/blog` (broken filter), `/imprint` and
`/contact` (mobile overflow). Plus a site-wide footer-links issue (F4/F5) and a
site-wide Slack placeholder (F6).

---

## Findings

### F1 — Blog category filter is non-functional · BLOCKER-ish MAJOR · `[CODE-BUG]`
**Pages:** `/blog` (desktop + mobile). **Screenshot:**
`qa-shots/blog-desktop-filter-engineering-BROKEN.png`

Clicking the **Article** / **Engineering** filter pills updates the selected tab
(`aria-selected`) and sets `#blog-grid[data-filter="Engineering"]`, but **no cards are
hidden** — all 37 cards stay visible (verified: with `data-filter="Engineering"` the
grid still shows 18 Engineering **and** 19 Article cards).

Root cause: every `PostCard` ships an **inline** `style="…;display:flex;…"`. The filter
relies on the stylesheet rule
`#blog-grid[data-filter="Engineering"] > [data-category]:not([data-category="Engineering"]) { display:none }`.
Inline styles win over stylesheet rules regardless of selector specificity, so the
`display:none` never applies. The card matches the hide selector (confirmed
`element.matches(...) === true`) but computes to `display:flex` because of the inline
style.

Fix options: move the card's `display:flex` (and the other inline layout props) into the
`.ag-card` class so the filter rule can override it; or add `!important` to the filter's
`display:none`; or have `CategoryFilter` toggle a `hidden` class / inline display
directly. The first is cleanest.

Note: the build-notes "filtering verified" check only confirmed the default `All`
state (everything visible) and the existence of the CSS rule — it never exercised a
non-`All` filter, so this slipped through.

Secondary observation (not a bug): `CategoryFilter` is `client:visible` and sits below
the fold, so it only hydrates once scrolled into view. That is expected behavior; once
visible it hydrates and the click handler fires — the filter still fails purely because
of the inline-style override above.

### F2 — Horizontal page overflow on `/imprint` and `/contact` at mobile · MINOR · `[CODE-BUG]`
**Pages:** `/imprint` (mobile), `/contact` (mobile). **Screenshots:**
`qa-shots/imprint-mobile.png`, `qa-shots/contact-mobile.png`

At 390px the page scrolls horizontally (`document.scrollWidth = 418` vs viewport 390 —
~28px). Offending element is the address `<dd>` containing
**"Agentatech UG (haftungsbeschränkt)"**. The legal-notice / direct-contact block uses a
two-column definition list (label fixed-width on the left, value starting at x=257), so
the value column is only ~133px wide and the long unbreakable word
`(haftungsbeschränkt)` can't wrap, pushing the column to x=418.

Fix: let the value wrap (`overflow-wrap:anywhere` / `word-break:break-word` on the
`<dd>`), or stack the `<dl>` to a single column at mobile width, or narrow the label
column. Desktop is fine.

### F3 — Explorer rows & accordion headers not keyboard-operable · MINOR (a11y) · `[CODE-BUG]`
**Page:** `/` (landing — "Build agents using skills and tools" explorer island).

The use-case rows (Code review / KPI dashboard / …) and the Skills / Agents.md / Tools
accordion headers are clickable `div`/`span` elements (`cursor:pointer`, real onClick)
but have **no `role="button"` and no `tabindex`**, so they don't appear in the a11y tree
as interactive and can't be focused or activated by keyboard. Mouse interaction works
correctly (verified: real click switches the detail panel; expanding "Tools" reveals
GitHub + Linear). Contrast: the blog filter pills and pricing billing toggle DO use
proper `role="tab"`/`role="radio"` — the explorer should match that pattern.

### F4 — Footer links to wrong/missing internal routes (404) · MAJOR · `[CODE-BUG]`
**Pages:** footer on ALL pages. (Reproduces build-notes "Legal/utility slice" items
#2/#3 — confirmed still present.)

Verified live status codes:
- "Privacy Policy" (Legal column) and "Privacy policy" (bottom bar) → `/privacy` → **404**.
  The real page is `/privacy-policy` (→ 200). Both footer links point at the wrong path.
- "DPA" → `/dpa` → **404** (no such page; live DPA lives at
  `docs.agenta.ai/administration/security/dpa`).
- "Trust Center" → `/trust` → **404** (should be the external
  `https://trustcenter.agenta.ai`).

These are real broken links shipping in the footer of every page. `/terms`, `/imprint`,
`/contact`, `/pricing`, `/blog` footer links all resolve (200).

### F5 — Footer / nav links to not-yet-built routes 404 · MINOR · `[CODE-BUG]` (known stubs)
**Pages:** footer + nav on all pages. (Build-notes slice 1 documents these as intended
to 404 until built — confirmed reproducing.)

- Footer "Product" column: `/product/prompt-engineering`, `/product/evaluation`,
  `/product/human-annotation`, `/product/deployment`, `/product/observability` → all **404**.
- Footer "Resources": `/tutorial`, `/changelog`, `/roadmap` → all **404**.
- Nav "Product" / "Resources" / "Community" → `/#` (dropdown affordances with a chevron
  but no panel; go nowhere).

Not new — flagging so they're tracked before launch (either build the pages, point at
docs/live equivalents, or remove the links).

### F6 — Slack link is a generic placeholder · MINOR · `[CONTENT]`
**Pages:** footer (site-wide) + `/contact` "Community" → Slack.

The Slack link is `https://join.slack.com/` (Slack's generic landing page), not Agenta's
actual workspace invite. Replace with the real Slack invite URL. Sourced from
`site.json`.

### F7 — Blog content/migration caveats · MINOR · `[CONTENT]` (known)
From build-notes "Blog slice" — confirmed on the live pages:
- All 37 posts are attributed to **Mahmoud Mabrouk**; **Ilyes Rezgui** and **Nizar
  Karkar** show **0 posts** on the authors index (`/blog/author`). Needs CMS
  re-attribution.
- A cluster of posts is dated **Feb 25, 2026** (inferred dates, visible on the related-
  posts cards) — cross-check real publish dates since the blog sorts by date.
- Internal article body links are still absolute `agenta.ai` / `cloud.agenta.ai` URLs
  (work, but should be site-relative).

### F8 — Pricing / legal design decisions still open · `[DESIGN]` (known)
From build-notes, no QA regression — surfacing for the design/decision owner:
- The **monthly/annual billing toggle** on `/pricing` is new vs the live Framer site;
  prices ($49/$39, $399/$319) and the trace/seat/retention limits are **placeholders**
  from `pricing.json`, not real plan data. Toggle itself works correctly (verified
  prices flip monthly↔annual).
- `/terms` (and `/privacy-policy`) render a **Termly holding page** with a
  "View the full Terms of Service" button → Termly. Pending the keep-redirect vs
  self-host decision.
- Author canonical route is `/blog/author/[slug]` (live Framer used `/authors/[slug]`;
  redirects added). Confirm canonical before launch.
- Imprint may be **missing German-law-required fields** (managing director,
  Handelsregister number, USt-IdNr.) — legal review.

---

## Interactions tested — checklist

| Interaction | Result |
|---|---|
| Landing (mobile): open nav hamburger → menu appears | **PASS** — `aria-expanded` flips, `.ag-mobile-menu` → flex, all 8 links + 2 CTAs shown (`landing-mobile-menu-open2.png`) |
| Landing: click a template in explorer → detail panel switches | **PASS** — real click on "Customer support agent" / "KPI dashboard agent" switches title, trigger, harness, skills (`landing-desktop-explorer-kpi2.png`) |
| Landing: expand a Skills/Tools accordion row | **PASS** — expanding "Tools" reveals GitHub + Linear items (`landing-desktop-explorer-tools-expanded.png`) |
| Landing: explorer rows keyboard-accessible | **FAIL (a11y)** — clickable divs, no role/tabindex (F3) |
| Pricing: monthly/annual toggle changes prices | **PASS** — $0/$49/$399 → $0/$39/$319, "billed yearly" labels, table headers update (`pricing-desktop-annual.png`) |
| Pricing: expand a FAQ item | **PASS** — native `<details>`, first open, clicking another opens it |
| Pricing: plan CTA hrefs correct | **PASS** — free/paid → `cloud.agenta.ai/`, Enterprise → `cal.com/…/demo` |
| Pricing (mobile): comparison table | **PASS** — scrolls inside `.cmp-scroll` (scrollW 812 > 388), no page overflow |
| Blog index: category filter pills filter the cards | **FAIL** — pills/tab state update but cards don't filter (F1) |
| Blog index: click a post card → navigates | **PASS** — cards are `<a href="/blog/<slug>">` with correct slugs |
| Blog post: code block monospace + horizontal scroll | **PASS** — Geist Mono, github-dark; mobile blocks scroll (scrollW 619–830 > 348) with NO page overflow (`blogpost-mobile-codeblock.png`) |
| Blog post: InlineCTA card present | **PASS** — "Ship reliable AI apps faster" + Star on Github / Get started (`blogpost-desktop-inlinecta.png`) |
| Blog post: related-posts cards + byline link to author | **PASS** — "More from the blog" 4 cards; byline → `/blog/author/mahmoud-mabrouk` |
| Author page: posts grid renders | **PASS** — 37 cards, avatar loads (460x460), no broken images |

---

## What goes where

- **Fix in code (CODE-BUG):** F1 (blog filter — MAJOR), F4 (footer `/privacy`,`/dpa`,
  `/trust` 404s — MAJOR), F2 (imprint/contact mobile overflow — MINOR), F3 (explorer a11y
  — MINOR), F5 (stub-route 404s — MINOR/known).
- **Content fix (CONTENT):** F6 (Slack placeholder), F7 (author attribution, dates,
  absolute body links).
- **Design / decision owner (DESIGN):** F8 (billing toggle + placeholder prices, Termly
  holding pages, author canonical route, imprint legal fields).
