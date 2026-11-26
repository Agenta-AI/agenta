---
name: "technical-seo-audit"
description: "Inspect crawlability, indexability, rendering, canonicals, redirects, links, schema and mobile/performance problems. Report evidence, not automatic production changes."
---

# Technical SEO audit

## Goal
Find technical problems that prevent useful pages from being discovered, understood or used well, and help the owner decide what is worth fixing. Focus on the site's real needs rather than generating a generic checklist or health score.

## Suggested approach
Understand the website, its important pages and the concern that prompted the audit. Ask about recent migrations or changes when they may explain symptoms. Use existing crawl or Search Console data where available.

Choose a scope that suits the site and question. Representative page types may reveal a shared template problem; a targeted URL inspection may answer a narrow question. Keep crawling bounded, respect site directives and rate limits, and explain the coverage instead of implying the whole site was checked.

Investigate likely causes, usually beginning with discovery and indexability: response codes, redirects, robots directives, sitemaps, canonical URLs and internal links. Distinguish a page blocked from crawling from one excluded with noindex. A canonical is a signal, not a guarantee, and missing traffic data is not proof that a page is unindexed.

Inspect actual rendered pages when JavaScript, mobile layout or structured data matters. Compare relevant raw HTML and rendered content. Text-only scraping can omit markup; absence from scraped Markdown does not establish absent schema. Check that structured data reflects visible content and current search-engine guidance.

Look at performance and usability where they affect the important pages. Separate a laboratory test from field measurements of real visitors. Record enough context to interpret the result, including device and whether field data describes the URL or the whole origin. Missing field data is an information gap, not a pass or fail.

Explain findings through affected pages, observed behavior, likely consequence and a practical fix. Prioritize real obstacles over cosmetic conventions. Avoid treating exact title lengths, word counts or schema presence as universal ranking rules. If fixes are requested, recheck the affected behavior after making them.

## Practical starting checks
Use these as a starting route, not a requirement to run every check on every task. For a general audit, start with the homepage, one important destination page, one article and one listing/category page where those types exist. Add examples when findings suggest a shared template problem. For a specific complaint, begin with the affected URL and a comparable working page. Record the sample; do not present it as a full crawl.

### Can search engines reach the right pages?
- Fetch robots.txt and the declared sitemap or sitemap index. Look for accidental blocks of important paths; inspect a sample of sitemap URLs for errors, redirects and unintended noncanonical or noindex pages. A sitemap helps discovery but does not guarantee indexing.
- Fetch important URLs with GET, recording status, redirect hops and final destination. Investigate loops, repeated server errors, broken links and pages displaying a not-found message while returning 200 (a possible soft 404). One failed fetch may be a temporary or tool-specific failure; verify before calling the site broken.
- Read robots meta tags, X-Robots-Tag headers and canonical declarations. Compare the declared canonical with the intended URL and its actual response. A robots.txt block is not a removal instruction and can prevent a crawler from seeing noindex. Do not flag deliberately excluded login, internal-search or private pages as defects.
- Where variants exist, sample HTTP/HTTPS, www/non-www, trailing-slash and parameter URLs. Look for conflicting redirects, canonicals, internal links and sitemap entries; do not recommend changing established URLs merely for cosmetic consistency.
- With Search Console access, inspect representative affected URLs and compare the recorded indexing reason and Google-selected canonical with the current page. Saved inspection data may predate a fix. A site: search is only a discovery clue, not a complete indexing count; without authoritative data, say indexing status is unverified.

### Can crawlers and readers discover the content?
- Follow real navigation and article links. Check that important destinations have crawlable anchor links with href values, and that pagination leads to deeper content without requiring a search form or user-only interaction.
- Compare discovered links with available sitemap or page inventories. Pages appearing only in an inventory are orphan candidates, not proven orphans when the crawl is partial. Prioritize useful contextual links rather than imposing a universal three-click rule.
- Compare raw HTML with a browser-rendered page. Check whether main content, links, titles, canonicals or robots directives disappear, conflict or depend on failed scripts. A successful browser render alone does not prove Google indexed it.

### Do shared templates produce useful pages?
- Inspect titles, main headings and descriptions across the sample for missing values, repeated boilerplate and mismatches with visible content. Flag template defects here; hand broader copy/intent improvements to editorial review. Fixed character counts, exact-match keywords and exactly one H1 are not universal ranking requirements.
- Inspect structured data in raw HTML and the rendered DOM, including JSON-LD script elements. Use Rich Results Test for supported Google features or an appropriate schema validator. Separate syntax errors, eligibility requirements and optional warnings. Valid markup does not guarantee a rich result, and not every page needs a special schema type.
- On mobile and desktop, check that the main content and navigation remain usable: no unintended horizontal overflow, obstructive overlays, broken images or unreadable controls. Check HTTPS and mixed-content failures affecting the page. Capture the actual defect rather than infer it from a score.

### What is making important pages slow or unstable?
- Use PageSpeed Insights or available browser performance tooling on representative templates. Note device, URL and test time. If CrUX field data exists, record its period and whether it covers the URL or origin; lab results are diagnostic, not a substitute for real-user measurements.
- Inspect LCP, INP and CLS where measured. Common good field thresholds at the 75th percentile are LCP at most 2.5 seconds, INP at most 200 milliseconds and CLS at most 0.1; check current guidance when applying them. Do not infer good INP from an ordinary page-load lab test or treat a Lighthouse score as a ranking score.
- Connect problems to evidence: an oversized hero image or delayed response may affect LCP; scripts and long tasks may impair interaction; images without reserved space or late-loading elements may cause shifts. Suggest the relevant fix, not a generic list of optimizations. Do not blanket-lazy-load the principal above-the-fold image.

### Extend the audit only where relevant
For multilingual sites, sample language versions, reciprocal hreflang annotations, valid language/region codes and agreement with canonical intent; x-default is optional. For large catalogs, investigate faceted URLs, pagination and repeated URL generation before raising crawl-budget concerns. After migrations, sample old-to-new redirects and links to retired URLs. These are branches of the investigation, not requirements for a small single-language blog.

### Turn checks into a diagnosis
Group repeated failures by their likely shared cause. For each important finding, give an affected URL, observed evidence, likely reader/search consequence, suggested fix and how to recheck it. Distinguish observations from suspected causes. For example: 'Three sampled articles canonicalize to the homepage; this may prevent their intended independent indexing. Check the article template and re-fetch the canonical on the same sample after correction.' Do not claim a ranking loss was caused by this without further evidence.

Lead with blockers to useful pages, then broader template problems and smaller improvements. Mark checks as observed, not checked or inconclusive in internal notes; unavailable tools are not passing results. Bring the owner the few decisions that matter rather than every diagnostic detail.

## Tools and integrations
Use HTTP and HTML/XML inspection for response headers, redirects, sitemaps and markup, plus a browser for rendered content and mobile behavior. Connected scraping services can help with page reading but may not expose the technical evidence needed.

Search Console can clarify Google's recorded view of a URL. PageSpeed Insights or CrUX can add performance evidence; existing crawler exports may help on larger sites. Use the tools appropriate to the question and ask for missing access when it materially affects the investigation.

## Useful output
A clear account of the most important problems, supporting examples and recommended next steps. Include enough evidence to reproduce the findings, and explain what was not checked. Let the format follow the task: a short diagnosis for one URL, or a broader report for a site audit.

## Organizing inputs and outputs
Read site goals/domain from canonical Knowledge or agent-files/00-context/, plus supplied URL lists, crawl exports and prior audits. Link original app input records under agent-files/apps/seo-workspace/inputs/ where applicable.

Use agent-files/01-research/technical-seo/<site>/<dated-run>/ for new audit evidence, or reuse an existing canonical audit location. Save original HTTP/crawl/browser/performance results in raw/, rendered captures in screenshots/, and interpreted findings in an audit note. Keep URLs, collection scope and dates with the evidence; retain earlier runs.

When an app Discovery owns the report, update agent-files/apps/seo-workspace/discoveries/ and link evidence rather than create a second editable report. Link page-specific follow-up to its content record. Update agent-files/INDEX.md for durable additions; app recovery copies are labeled archives.

## Scope
Technical accessibility overlaps with site architecture, but deciding which topics and pages should exist is a separate editorial question. Share crawl findings with that work rather than repeating the crawl. An audit recommendation does not itself authorize a production deployment.
