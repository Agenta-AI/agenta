# Handoff to the design agent — Agenta marketing website (updated 2026-06-27)

You own the **design source-of-truth** in the repo-root folder
`Agenta landing page pivot/` (the `*.dc.html` Design Components, the `handoff/*.md`
contract, and the `content/*` samples). We (implementation) rebuilt the site as a
git-based **Astro** app in `website/` and ported your designs faithfully. This is the
**current** handoff: most earlier open items are now decided or done; what remains is
below.

## Hard rule we are now following: do not break the live URL map

The new site must keep the **exact URLs and link destinations of the live
agenta.ai**, for SEO/canonical reasons. We only ADD pages; we never change or break
an existing URL or redirect. We mapped the whole live site
(`research/live-url-link-map.md`) and aligned the build to it. Please respect this
rule in any design that introduces or moves a page: tell us the intended URL and we
will keep it consistent with the live map.

## 1. Design work we need from you (pages with no DC)

We built clean but **minimal** dark versions of these. They have **no Design
Component** yet — please design them properly:

- `/imprint` — German Impressum (also serves as the contact details on live).
- `/contact` — we kept a simple contact page (decision below).
- `/terms` and `/privacy-policy` — these **redirect** to external policy pages
  (termly), so they don't strictly need a full design, but confirm that's fine.
- `/authors` — the authors index (a simple 3-card grid today).
- **Co-author byline treatment** — some posts now have two authors (see §3). We
  render stacked avatars + "Name & Name". If you want a specific co-author layout in
  the blog-post DC, design it.

## 2. Assets the Agenta team must provide (not design-tool work, but blockers)

- **Licensed font binaries** — we currently ship the **trial** GT Alpina + PP
  Mondwest. Provide the licensed binaries; we inject them at build time and they stay
  out of the public repo.
- **Landing video(s)** — the live site has no video; the design has two slots
  (hero "build a support agent in 2 min" and the "Monitor usage" section). We will
  embed via **YouTube** (decided). Provide the final videos or their YouTube links.
- **Real pricing numbers** — `content/pricing.json` has placeholders. (Mahmoud is
  reworking pricing separately, so this is on the Agenta side, not the design agent.)
- **Imprint legal fields** — confirm the German-law-required fields (managing
  director, Handelsregister no., USt-IdNr.) are present and correct, verbatim.

## 3. Decided / already done since the last handoff (FYI, no action)

- **Author page URLs = live's `/authors/<slug>/`** (not the design's
  `/blog/author/*`). Done — canonical rule. The blog-post DC's author link should
  point at `/authors/<slug>`.
- **Author attribution fixed.** Ilyes Rezgui: `chunking-strategies`,
  `top-llm-gateways` (sole) + `top-10-techniques` (co-authored w/ Mahmoud). Nizar
  Karkar: `how-to-evaluate-rag` (co-authored w/ Mahmoud). The other 33 are Mahmoud.
  Co-author display + per-author listing implemented.
- **All nav/footer links matched to live exactly.** Footer Product links → the live
  `docs.agenta.ai` URLs (there are no `/product/*` pages). Resources/Legal → live
  docs URLs. Real **Slack** invite links wired (nav and footer use different
  tokens, matching live). Added the missing YouTube footer icon. Removed the phantom
  "Product" nav dropdown that live doesn't have.
- **`/contact` and `/imprint`** — kept as we have them (Mahmoud's call).
- **`/terms` and `/privacy-policy`** — replicate live: the routes 308-redirect to
  termly; the footer legal links point to docs. (Open question for Mahmoud only: live
  splits these — termly for the routes, docs for the footer links. Confirm or unify.)
- **Pricing monthly/annual toggle** — kept; pricing is deferred to Mahmoud.
- **Light theme** — not now. We are keeping the door open for it later, but it's out
  of scope for this pass.

## 4. Minor content follow-ups (our side, FYI)

- ~16 blog post dates were inferred during migration (a `2026-02-25` cluster); we
  will cross-check against the CMS records.
- In-body blog links are still absolute `agenta.ai` URLs; we will rewrite them to
  site-relative paths.

When you update the design for anything in §1, change the matching `handoff/*.md`
and/or `content/*` sample in the same edit so we can diff and implement the delta,
and tell us the intended URL so we keep the live map intact.
