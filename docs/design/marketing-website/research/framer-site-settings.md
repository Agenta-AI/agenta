# Framer site settings (extracted)

**Date:** 2026-06-27
**Source:** the LIVE `https://agenta.ai/` `<head>` (raw HTML, not rendered), plus
redirect probes against the live site.
**Why live-HTML, not the Server API:** the Framer Server API needs the project
URL/ID (`framer.com/projects/<id>`) in addition to the API key, and the owner has
only supplied the key so far. The key alone fails with
`FRAMER_PROJECT_URL environment variable is required`. Until the project URL is
provided, site-level config that the API exposes (`getProjectInfo()`,
`getRedirects()`) cannot be read from the API, so everything below is parsed from
the live site instead. See `framer-raw-export.md` for the API path.

The live site is confirmed Framer-built: `<meta name="generator" content="Framer
108c8c6">` and pervasive `data-framer-*` attributes.

---

## Head metadata (key → value)

| Key | Value |
|---|---|
| `<title>` | `Agenta - Prompt Management, Evaluation, and Observability for LLM apps` |
| `meta description` | `Agenta is an open-source platform for building robust LLM Application. It provides tools for prompt engineering, evaluation, debugging, and monitoring of complex LLM Apps.` |
| `og:type` | `website` |
| `og:title` | (same as `<title>`) |
| `og:description` | (same as `meta description`) |
| `og:url` | `https://agenta.ai/` |
| `og:image` | `https://framerusercontent.com/images/s413ZDbKMBOdimQ7YZUIM7gHCrI.png` |
| `twitter:card` | `summary_large_image` |
| `twitter:title` | (same as `<title>`) |
| `twitter:description` | (same as `meta description`) |
| `twitter:image` | (same as `og:image`) |
| `canonical` | `https://agenta.ai/` |
| `theme-color` | **NOT SET on the live Framer site** (no `meta theme-color`). Our Astro `Base.astro` sets its own `#0A0A0B`. |
| `color-scheme` | not set |
| `generator` | `Framer 108c8c6` |

Note: the live Framer homepage title/description differ from the new Astro site's
defaults (`Base.astro` uses "Agenta — Build agents and AI automations that work").
The values above are the *current production* Framer copy, captured for reference;
they are not automatically the new site's copy.

---

## Icons

| rel | live URL | downloaded to | dimensions |
|---|---|---|---|
| `icon` (favicon) | `https://framerusercontent.com/images/QgINO4d6KMrmyLUHaL4ZYzHzBwQ.png` | `website/public/favicon.png` | 32 × 32 PNG |
| `apple-touch-icon` | `https://framerusercontent.com/images/e9TIF4lkFt6tISdbE5HHJzfymaY.png` | `website/public/apple-touch-icon.png` | 180 × 180 PNG |

- Framer ships the favicon as a **PNG** (no `.ico`, no `.svg`). There is no SVG
  favicon and no `.ico` on the live site.
- The new Astro site currently wires a different icon in `Base.astro`:
  `<link rel="icon" href="/logos/Agenta-symbol-dark-accent.svg">` and emits no
  `apple-touch-icon`. The downloaded Framer PNGs are now in `public/` so the owner
  can switch to them or keep the SVG. **No layout code was changed** (extraction
  task only).

---

## Social preview / OG image (default card)

| Field | Value |
|---|---|
| Live `og:image` | `https://framerusercontent.com/images/s413ZDbKMBOdimQ7YZUIM7gHCrI.png` |
| Dimensions | **1280 × 720** (16:9) PNG |
| Downloaded to | `website/public/og/framer-default.png` |

The new Astro site already has its own tuned default card at
`website/public/og/default.png` (**1200 × 630**, the standard OG aspect). That file
was **left untouched**; the Framer original is saved alongside as
`framer-default.png` for comparison. `Base.astro` references `/og/default.png`.

---

## Redirects

The Server API's `getRedirects()` would give the authoritative Framer redirect
list, but it is blocked on the project URL. Observed live behavior (HTTP probes):

| Path | Status | Location |
|---|---|---|
| `/terms` | 308 | `https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7` |
| `/privacy-policy` | 308 | `https://app.termly.io/document/privacy-policy/ce8134b1-80c5-44b7-b3b2-01dba9765e59` |
| `/launch-week-1` | 200 | (live page still exists; not a redirect) |
| `/launch-week-2` | 200 | (live page still exists; not a redirect) |
| `/docs` | 301 | `https://agenta.ai/docs/` (trailing-slash normalization) |
| `/blog/` | 308 | `/blog` (trailing-slash drop) |
| `/authors/<slug>` | 308 | `/authors/<slug>/` (author profiles KEEP the trailing slash) |

Discrepancy worth flagging: the existing `website/public/_redirects` maps
`/privacy-policy` → `app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-...`,
but the LIVE site now 308s `/privacy-policy` to
`app.termly.io/document/privacy-policy/ce8134b1-...` (the newer Termly "document"
URL form). The terms URL still matches. Consider updating `_redirects` /
`astro.config.mjs` to the live `document/...` form for privacy-policy.

The existing `_redirects` already encodes `/terms`, `/privacy-policy`,
`/launch-week-1 → /blog`, `/launch-week-2 → /blog`. See
`live-url-link-map.md` for the broader link map.

---

## URL-parameter behavior (query / utm persistence)

**The live Framer site DOES preserve query params across internal navigation.**

Framer injects an inline `<script data-preserve-internal-params>` (and tags
internal links with `data-framer-preserve-params`). The exact behavior:

- Triggers only when `window.location.search` is non-empty (i.e. the visitor
  arrived with query params such as `?utm_source=...`).
- Selects every internal link in `div#main`: `a[href^="#"]`, `a[href^="/"]`,
  `a[href^="."]`, plus any `a[data-framer-preserve-params]`.
- For each such link, it **merges the current URL's query params into the link's
  href**, appending any param the target href does not already have (target's own
  params win on conflict). The hash fragment is preserved.
- It **excludes** the internal `framer_variant` param (Framer A/B variant marker)
  from propagation.
- It is **skipped for bots/crawlers and headless** (`navigator.webdriver`, and a
  UA regex for `bot|google|yandex|ia_archiver|crawl|spider`), so SEO/canonical is
  unaffected.

Net effect: a visitor landing on `agenta.ai/?utm_source=x&utm_campaign=y` carries
`utm_source` / `utm_campaign` (and any other arriving query params) onto every
internal link they click, so attribution survives navigation. This is the behavior
to replicate on the Astro site (a small client-side script that rewrites
same-origin link hrefs with the current `location.search`, excluding internal
markers, skipping bots).

The page body also carries `data-framer-preserve-params` on the root, confirming
the feature is enabled at the project level (Framer Site Settings → "Preserve URL
parameters").

---

## Downloaded asset paths (summary)

| Asset | Saved to |
|---|---|
| Favicon (32×32 PNG) | `website/public/favicon.png` |
| Apple touch icon (180×180 PNG) | `website/public/apple-touch-icon.png` |
| OG default card (1280×720 PNG, Framer original) | `website/public/og/framer-default.png` |

Raw homepage HTML snapshot used for parsing is in the session scratchpad
(`framer-dump.json` / `agenta-home.html`), not committed.

---

## Still needed from the owner (to read the rest via the API)

- The **Framer project URL/ID** (`framer.com/projects/<id>`). With it,
  `getProjectInfo()` and `getRedirects()` give the authoritative site title, SEO
  defaults, and the full redirect table directly from the project, instead of
  inferring from the live HTML.
