---
name: update-public-surfaces
description: Carry one change (a tagline, positioning line, feature or product name, link, pricing, logo, social handle) to every user-facing place in the agenta repo that shows it, then list the outside accounts to update by hand. Use whenever someone says "we renamed X", "change the tagline", "update the Slack link everywhere", "the pricing changed", "new logo", "make the site and README say Y", or asks which marketing or public places need an edit after a change. Covers the website, GitHub README, changelog, docs, PyPI page and in-app links. Not for writing a new changelog entry (use create-changelog-announcement) or a social post (use write-social-announcement).
---

# Update public surfaces

A change to how Agenta presents itself must land everywhere a user reads it. One stale
place (an old Slack invite in a blog post, a pre-pivot keyword on PyPI) makes the product
look careless. This skill finds every place, edits the clear ones, asks about the unclear
ones, and ends with the manual steps outside the repo.

## The surfaces

These are pages, not files. Search inside each one; do not assume the list of files.

| Surface | Where in the repo |
|---|---|
| Website (landing, pricing, blog, templates marketplace, creators, API, contact) | `web/website/src/` |
| Website nav, footer, share image, logos, `llms.txt`, SEO meta and JSON-LD | `web/website/src/components/`, `src/layouts/`, `web/website/public/`, `src/pages/llms.txt.ts` |
| GitHub README (English + Chinese, Japanese, Korean), CONTRIBUTING, templates | `README*.md`, `CONTRIBUTING.md`, `.github/` |
| Changelog and roadmap | `docs/blog/entries/`, `docs/src/data/roadmap.ts` |
| Docs | `docs/docs/`, `docs/docusaurus.config.ts`, `docs/static/images/` |
| Web app (page titles, meta, embed widget copy) | `web/mobile/src/pages/_document.tsx`, `web/mobile/src/pages/_app.tsx`, `web/mobile/src/features/`, `web/mobile/public/` |
| In-app help links | `web/packages/agenta-navigation/src/supportLinks.ts` |
| PyPI page (text and keywords) | `sdks/python/README.md`, `sdks/python/pyproject.toml` |

Outside the repo (manual only): X, LinkedIn, YouTube, Slack community, Product Hunt,
cal.com demo page, GitHub repo description, topics and social preview, GitHub org profile.

Not surfaces: `docs/build/`
(generated), `docs/drafts/` and `docs/blog/announcement-assets/` (unpublished drafts),
`docs/versioned_docs/` (frozen v1.0 docs, never edit), `docs/design/`, `openspec/`,
`plans/`, tests.

## Procedure

1. **List every old value, then the new one.** A change often has several old forms: two
   expired invite tokens, a link in `agenta-hq.slack.com/join/` and `join.slack.com/t/`
   form, `twitter.com` and `x.com`, or a positioning line said five ways ("LLMOps",
   "prompt management", "LLM observability", "LLM app"). If the user gave only the new
   value, search for the stable part (`agenta-hq`, `zt-`, `agenta_ai`) and treat every
   value that is not the new one as old. Write the result as one line, for example
   `zt-1zsafop5i…, zt-2yewk6o2b… → zt-37pnbp5s6…`. If you cannot work out the old forms,
   ask before you search.

2. **Search every surface.** One pattern per old form, with the noisy folders excluded:

   ```bash
   rg -n -i "<old form>" web/website/src web/website/public README*.md CONTRIBUTING.md .github \
     docs/docs docs/versioned_docs docs/blog/entries docs/src docs/docusaurus.config.ts \
     web/packages/agenta-navigation/src sdks/python/README.md sdks/python/pyproject.toml \
     -g '!docs/build/**' -g '!web/oss/**' -g '!web/ee/**'
   ```

   Images and logos do not show up in a text search. If the change is visual, list the
   image files on each surface and say which ones look affected.

3. **Sort each hit into one of three groups.**
   - **Edit:** current, user-facing text that plainly states the old thing (landing copy,
     nav, footer, SEO meta, README, docs pages, PyPI text and keywords, help links). A
     dead link (an expired invite, a moved page) is always Edit, even in an old post: a
     link that goes nowhere helps no one.
   - **Ask:** the judgment calls listed below.
   - **Skip:** anything under "Not surfaces", and names that are code or protocol rather
     than text a user reads: `twitter:card` meta names, a badge service path such as
     `shields.io/twitter/follow`, icon keys, env vars like `TWITTER_OAUTH_*`, a plain word
     that only looks like the old value.

4. **Ask once, in one batch.** Put every Ask item into a single `AskUserQuestion` call
   before you edit them. Name the file, quote the line, and give the options. A wrong guess
   either rewrites a dated record or leaves a stale page, so do not decide these alone.

5. **Edit, keeping pairs in sync.**
   - Each website page has a markdown copy (`<page>.md.ts`) that AI crawlers read. Edit
     both, including the page's meta description.
   - The four READMEs share one structure. Change all four. Translate the new wording
     yourself only when the change is a link, a name or a number; for new prose, ask.
   - Generated files (the in-app What's New `changelog.json`, docs `llms.txt`,
     `public/openapi.json`) are not hand-edited. Regenerate them or leave them.
   - Pricing lives in two places: `web/website/src/data/pricing.json` and
     `docs/docs/administration/billing/`. Numbers and plan copy must agree.

6. **Report.** End with three short lists:
   - Edited: each file, one line on what changed.
   - Skipped or left as is: each file and why (the user's answer, or not a surface).
   - Manual steps outside the repo: only the accounts this change touches, with what to
     update on each (bio, banner, description, topics, pinned post). Say when a change only
     goes live later, for example PyPI text on the next SDK release.

   Do not commit or push unless the user asks.

## When to ask

- **Wording in old blog posts and old changelog entries.** They are dated records. Posts
  dated before 2026-07-01 already show an "earlier era" notice (`web/website/src/lib/blog.ts`),
  so old product wording there is usually fine to leave. Ask once for the group, and list
  the posts. Dead links in them are not a question; fix them.
- **`docs/versioned_docs/`.** Ask whether the old version is still published or frozen.
- **A hidden component** (a flag such as `SHOW_INLINE_CTA = false`) with stale copy: rewrite
  and keep hidden, rewrite and show, or leave.
- **Translated README prose** that needs real translation, not a swapped link.
- **Docs pages that describe behavior**, when the change is a positioning or naming
  change. The docs may need the old name until the product UI changes.
- **A near match** that might be a different thing (the "evaluation" feature vs. the plain
  word).
- **Product UI strings** in `web/mobile` or `web/packages` (other than `supportLinks.ts`).
  That is product work, not a copy change.
- **A place not listed above** that still looks public. Name it and ask whether it belongs.
