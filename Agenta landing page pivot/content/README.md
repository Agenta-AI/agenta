# content/ — sample data = the CMS schema by example

These files are **real-shaped sample content**. They are the working examples of
the schemas documented in `../handoff/CONTENT_MODEL.md`. Two jobs:

1. **For the design track:** pages render from data in exactly these shapes, so
   the mocks show real structure (not lorem ipsum).
2. **For the implementation track:** when you wire a CMS, your collections must
   produce these shapes. When the user writes a new blog post, they add a file
   here in the same shape — design and CMS stay in lockstep.

```
content/
  site.json            globals: nav, footer, CTA band, inline CTA
  pricing.json         the entire pricing page as data (PLACEHOLDER numbers)
  authors/
    mahmoud-mabrouk.json
  posts/
    prompt-drift-what-it-is-and-how-to-detect-it.md   (full body)
    the-definitive-guide-to-prompt-management-systems.md  (featured; stub body)
```

## Adding a blog post (the common case)

1. Create `posts/<slug>.md`.
2. Fill the frontmatter — every field in `CONTENT_MODEL.md → post`. `slug`,
   `title`, `description`, `category`, `date`, `author` are required.
3. Write the body in markdown/MDX. Drop `<InlineCTA />` where you want the
   in-article CTA (or rely on auto-insert — implementation decision).
4. Set `featured: true` (+ `featuredRank`) only for posts that should appear in
   the blog index's featured row.

## Editing pricing

Edit `pricing.json`. Card order = array order. `popular: true` highlights a plan.
Comparison cells: `true` → check, `false` → dash, `"string"` → literal. **The
numbers are placeholders — replace with real plan data.**

## Editing global chrome

Edit `site.json` — nav links, footer columns, the yellow CTA band, and the
in-article CTA are all here so they're changed once and reflected everywhere.
