---
name: tavily-job-search
description: Use when searching the web for job openings, comparing job-board search strategies, validating listings, and extracting job details with Tavily.
---

# Tavily Job Search and Page Extraction

Use this skill to discover job openings with Tavily, compare sources, verify relevance, and extract useful details from shortlisted postings. Tavily is web search and extraction, not a structured jobs API: results can be duplicated, stale, mislocated, incomplete, or mixed with recommendations and similar jobs. Verify each posting rather than treating a query result as authoritative.

## 1. Build focused searches

1. Start with the target title, city, and country in the query, such as `Data Engineer jobs Berlin Germany`. Use role variants when useful: `Senior Data Engineer`, `Data Platform Engineer`, `Analytics Engineer`; add local-language variants where relevant (for Munich, try both `Munich` and `München`).
2. Search distinct source groups separately so source quality and noise are visible. Use `search_depth: "advanced"`, `max_results: 10`, and an explicit country name for the `country` boost:
   - Aggregators and tech boards: `include_domains: ["startup.jobs", "wellfound.com", "builtin.com", "englishjobs.de"]`.
   - LinkedIn: `include_domains: ["linkedin.com"]`.
   - Indeed: `include_domains: ["indeed.com"]`; optionally test a country-specific host such as `de.indeed.com`.
   Keep the actual query explicit about city + country even when `country` is set.
3. Run multiple city/role combinations independently. For example, Berlin + Data Engineer, Munich + Machine Learning Engineer, and Amsterdam + Backend Engineer. If a week filter returns too few viable roles, widen `time_range` to `month` or remove it, then verify each role is still open from the posting or official careers page.
4. Treat `country` as a relevance boost, not a strict geographic filter. `include_domains` restricts the source domain, not the job location. A country-specific Indeed hostname did not remove unrelated roles. In testing, `exact_match: true` on a quoted title did not reliably eliminate geographic noise either; use it only as a query precision experiment, never as a substitute for checking the location.

## 2. Screen and verify the search results

For each candidate, inspect the result's title, URL, snippet, and the text of the posting itself. Keep only roles whose actual location or eligible remote region matches the user's target. Do not infer location from the query page or a “similar jobs” section. For example, Berlin may mean Berlin, Germany or a U.S. town such as Berlin, Connecticut or Massachusetts; a result labelled “Berlin, Free State” needs corroborating context before inclusion.

Check and record:

- Exact title, employer, location / remote eligibility, and employment type when shown.
- Posting date, deadline, and whether the role is still accepting applications. A recent search result is not proof that a posting is open; pages can say removed, expired, or no longer accepting applications.
- Whether the page is the actual vacancy or only a results/category page containing a matching snippet.
- Duplicate postings across aggregators and LinkedIn/Indeed. Deduplicate by employer + normalized title + location, preferring the employer's own active careers page as the canonical apply link.

LinkedIn often returns broad EEA/DACH or remote roles and many adjacent “similar jobs.” Its page can still expose useful role details and a named recruiter/job poster; verify that the person and contact information belong to the exact vacancy. Indeed can surface valid roles but also wrong-country mirrors and irrelevant snippets. A Germany-only host may reduce some domain noise, but it is not a location filter.

## 3. Extract shortlisted postings

After screening, call the available Tavily extract tool on a small shortlist (typically 3–5 direct posting URLs), using `extract_depth: "advanced"`, `format: "markdown"`, and a focused query, for example:

`Extract the exact role title, employer, location, posting/deadline/status, responsibilities, required and preferred skills, salary, team context, named hiring contact, and apply URL.`

Extraction is uneven by source. In testing, a LinkedIn Booking.com posting yielded responsibilities and requirements; a LinkedIn recruiter post exposed a recruiter's name and technical requirements; an aggregator page returned only a partial job summary; a direct Indeed posting failed to fetch. When extraction fails or is partial:

1. Keep the failure explicit; do not fill missing details from assumptions.
2. Use the Tavily search snippet as a lead, not as verified page content.
3. Search the exact title + employer and look for the employer's own careers page; extract that canonical page if available.
4. If no authoritative source can be reached, mark the field unknown and retain the third-party URL only as a lead.

For company/team research, run separate targeted searches or Tavily research after selecting the actual jobs. Seek official product, careers, engineering/blog, team, and recent-news pages. Attribute facts to the source URL and distinguish directly published information from inference.

## 4. Recommended run shape

1. Search across the relevant source groups and role/city variants.
2. Merge and deduplicate candidates; verify geography, recency, and active status.
3. Extract only the best-matching direct job pages.
4. Research each employer and relevant team from public sources.
5. Produce a shortlist with apply links, evidence-backed fit notes, contact leads only when publicly named, and clear caveats for stale, incomplete, or unverified details.

Optimize for verified relevant opportunities, not raw result count. If the user explicitly asks for a broad lead list, show the noisy leads separately from verified matches.
