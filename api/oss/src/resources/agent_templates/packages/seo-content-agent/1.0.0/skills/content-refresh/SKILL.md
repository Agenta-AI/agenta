---
name: "content-refresh"
description: "Diagnose outdated or declining content and prepare or execute a scoped refresh through briefing, production and review, without implicit republishing permission."
---

# Content refresh

## Goal
Keep existing content useful as the website, audience and surrounding information change. Work out whether a page needs attention and what kind of improvement would matter, rather than rewriting it simply because it is old.

## Suggested approach
Read the existing page, its intended purpose, previous feedback and any relevant history. Understand why a refresh is being considered: outdated facts, a reader problem, changed search intent, broken assets or a performance concern. Ask the owner about changes the public page may not yet reflect.

Investigate the affected material and compare it with current sources and audience needs. When performance data is available, compare like periods and consider seasonality, incomplete data, technical issues and measurement changes before concluding the content has deteriorated. A factual update can still be worthwhile without analytics; it should not be described as a response to measured decline without evidence.

Recommend the appropriate level of work. That may be leaving the page alone, correcting a detail, improving an explanation, adding new proof or revisiting the angle. Consider consolidation only when it genuinely helps readers, not just because two pages share keywords.

Explain the important changes to the owner and clarify questions that affect direction. Substantial changes should go through the brief discussion and approval; a specifically requested small correction should not turn into an unrelated rewrite.

Use the production and editorial-review skills to carry out the agreed work. Preserve useful approved material and the page's history. Check affected examples, links and visuals, and keep publication decisions under the current publishing workflow. URL moves, deletions and redirects need their own authorization.

After publication, suggest an appropriate way to learn whether the change helped. Choose a useful observation period and outcome for the page rather than promising a recovery or inventing a schedule.

## Practical diagnosis and refresh format

### Establish what changed
Begin with the page's purpose, original publication and meaningful update dates, current state and the reason for review. For a factual correction, verify the affected material directly; analytics is optional. For reported performance decline, inspect comparable complete periods and, where useful, year-over-year context. Use the same property, URL grouping, search type, country/device and filters. Consider traffic volume and normal variability before choosing a window; there is no universal number of days that establishes decay.

Read clicks, impressions, CTR and position together, plus qualified outcomes where tracking is available. Lower impressions may reflect lower demand or lost visibility. Stable impressions with lower clicks may reflect changed result presentation, query mix or CTR. Lower conversions with stable traffic may involve audience mix, tracking or the visitor journey. These are hypotheses, not diagnoses. Check query/page segments, technical state and recent site changes before blaming the copy.

### Compare the page with today's task
Revisit relevant current results and audience questions. Look for a changed reader task, outdated procedure, missing example, broken asset or unsupported claim. Compare the page's promise with what it actually delivers. Use competitor pages to identify questions worth examining, not to justify copying everything they added. Preserve useful original material and recognize where the page already answers the question well.

### Propose the smallest useful intervention
A refresh note can contain: current URL and purpose; evidence/reason; recommended change; sections to keep; sections/assets to update; proof needed; approval scope; and how to judge the result. Use a short note for a small fix and a fuller brief when the angle changes.

Useful options include leaving the page unchanged, repairing a technical problem, correcting facts, improving an example or procedure, adjusting a misleading title, or substantially rebriefing the piece. Recommend consolidation only after examining distinct intents, links and the consequences for each URL. Do not change dates just to simulate freshness, expand length without a reader need, or rename URLs for cosmetic SEO.

### Recheck and learn
After approved work, use production and review rather than duplicate their methods. Check that the fix solves the original issue and has not broken other content. Record the actual publication date separately from draft completion. Compare later results with the baseline after a suitable observation period, noting seasonality, other releases and instrumentation changes. Suggest an observation plan without creating a schedule unless requested. A before/after improvement is not by itself proof of causation.

## Refresh priors and examples
- **Accuracy problems deserve repair even without a traffic decline.** An outdated command is a concrete defect. Correct and test it within the authorized scope rather than waiting for analytics.
- **Technical and measurement failures come before speculative rewrites.** If the page was accidentally noindex or tracking stopped, investigate that first. More paragraphs will not fix those problems.
- **A narrow evidence-backed improvement is often preferable to replacing the whole article.** Override when the reader's task or approved direction has genuinely changed and a new brief is approved.
- **Age alone is weak evidence of a problem.** A stable reference may need no change; a recent pricing comparison may already be outdated.
- **Preserve what is working, but do not treat past rankings as proof of current quality.** Keep useful examples and established URLs by default while evaluating present needs.

Illustrative decisions: fix a broken tutorial step when the interface changes; investigate seasonal demand before rewriting a guide whose impressions declined; propose a new brief when the query now calls for a different type of resource. These examples are starting reasoning patterns, not findings about the current website.

## Tools and integrations
Use existing content and history, connected search and webpage retrieval, and the production/review tools needed for the change. Search Console or the site's analytics can help investigate performance where relevant; ask for access or exports when that evidence is needed.

## Useful output
An explanation of whether to refresh the page and why, followed by the agreed improvement when authorized. Keep enough history to understand what changed and to compare later results. Match the depth of reporting to the size of the change.

## Organizing inputs and outputs
Start with the original identity/publication record. Production content uses agent-files/02-pipeline/<slug>/ and live records in agent-files/03-published/. App content stays in agent-files/apps/seo-workspace/content/<slug>/; Published is a view of the same identity. Read linked performance from agent-files/04-measurement/ and existing research notes.

Save rationale, scope and changes beside the original brief/draft in its existing refresh note, or refresh.md. Keep dated performance exports and source/filter details in the established measurement location or agent-files/04-measurement/<slug>/<dated-run>/raw/. Link baseline and later measurements to the refresh note. Save new public research and raw evidence under a dated agent-files/01-research/ folder.

Update the original draft through production/review rather than creating another article. After verified publication update the original live record, preserving its history. Update agent-files/INDEX.md for durable additions. App-owned records remain authoritative; recovery snapshots are explicitly archived copies.
