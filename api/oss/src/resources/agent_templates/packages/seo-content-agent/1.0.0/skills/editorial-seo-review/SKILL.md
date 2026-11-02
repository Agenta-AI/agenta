---
name: "editorial-seo-review"
description: "Check facts, editorial quality, positioning, SEO, links, attribution, visuals and conversion before the owner's publish-readiness decision."
---

# Editorial and SEO review

## Goal
Help the owner publish something accurate, useful and well presented. Review from the reader's perspective as well as the site's goals, finding meaningful problems rather than performing checklist theatre.

## Suggested approach
Read the current draft, approved brief and relevant owner feedback. Understand what the piece is trying to do and the voice it should use. Use the existing pre-publish quality playbook as supporting guidance, applying its checks to the actual page and publishing target.

Assess whether the piece answers its intended question, explains important ideas clearly and contributes something useful. Look for unsupported claims, unfair comparisons, confusing structure or distracting repetition. Check consequential facts against relevant evidence and discuss questions that the owner is better placed to answer.

Examine the reader's practical experience: links, figures, captions, examples, mobile layout and the next action the page offers. Verify metadata and relevant SEO details in the actual publishing format. A rendered preview shows things the Markdown alone cannot; distinguish preview findings from checks that need the live page.

Prioritize issues that affect trust, usefulness or publication. Make authorized corrections without rewriting unrelated approved material. Keep technical detail available for fixing problems, but present the owner with the decisions and changes that matter.

Use judgment about what applies. An old checklist's reference to a different CMS is not a reason to duplicate records. Structured data should reflect the visible page and current search guidance, not a promise of special search placement. If a necessary check cannot be performed, explain what remains unverified.

The existing factual, editorial, positioning, technical SEO, link, attribution and conversion checks still apply before readiness. The owner approves the reviewed version before it moves to Ready to publish; material changes need renewed approval.

## Practical review passes
Start with the actual version under review, not an earlier approved screenshot or a plan. Use the owner checklist and publishing specification for detailed requirements. The following lenses help prioritize the work without creating another competing checklist.

### Promise, structure and voice
Compare the title, opening, main answer and next action with the approved brief. Read headings alone, then read the whole piece. Look for missing prerequisites, repeated sections, unexplained terms and conclusions that do not follow from the body. For tutorials, can the reader complete the task? For comparisons, are the criteria consistent and recommendations tied to reader needs? For explanations, does the example actually clarify the idea? Distinguish a defect from your stylistic preference before changing approved copy.

### Claims and proof
Trace consequential facts to the cited material, not merely to a source that mentions the topic. Check the exact number, denominator, date, product version, plan and limitations where relevant. Confirm that a citation supports the claim's strength; a vendor assertion is not an independent test. Verify quotations and ensure hypotheticals are recognizable. An absent feature in documentation does not prove a product cannot do it.

Inspect superlatives and causal language especially carefully. 'Fastest', 'secure' and 'increased revenue' need the relevant comparison, threat model or measurement. Qualify, substantiate or remove unsupported claims rather than hide them behind fluent wording. Keep the evidence trail internal, but leave decision-relevant limitations visible to readers.

### Reader experience and publishing format
Follow important links to their intended destinations, not just a successful status code. Check links to planned pages are not presented as live. Inspect code and procedural examples against their test evidence; retest changed steps when feasible. Open every asset, including the last figure, and inspect the rendered page on desktop and mobile for legibility, crop, overflow, captions and placement.

Verify title/description, canonical, robots directives and relevant structured data in the actual output where available. Check that social metadata uses the intended cover, and that citations and attribution survive formatting. A preview can intentionally be noindex; distinguish that from an accidental production directive. Record live-only checks as pending rather than claiming preview evidence proves live indexing.

### Resolve and hand off
Correct authorized defects and recheck affected behavior. Group remaining issues by what prevents publication, what needs an owner decision and what is optional. For each substantial issue, provide the location, evidence and a concrete fix. Example: 'The table says all plans include export, but the cited pricing page limits it to a paid tier. Correct the row and recheck the paragraph that repeats it.'

The owner-facing summary should say what changed, what still matters and what decision is requested. Detailed checks remain in internal review notes. A useful handoff can be: recommendation, important fixes, unresolved blockers and the reviewed-version link. No rigid score is needed. Owner approval is still required for Ready to publish; the review cannot grant it.

## Review priors
Trust and usability failures usually matter more than cosmetic SEO conventions. Review important claims and actual behavior before polishing wording. A failed source lookup is unknown, not permission to guess; a missing test is unverified, not passed. Preserve strong approved passages rather than rewrite for novelty. Fixed word counts, keyword density and AI-detector scores are not reliable quality verdicts. A technically valid page can still be unhelpful, and excellent prose can still contain publication blockers.

## Tools and integrations
Read the draft, evidence, voice guide and existing pre-publish playbook. Use connected page retrieval for verification, HTTP checks for links and headers, and the site's build/preview tools and browser for rendered inspection. Choose tools to answer actual review questions rather than connecting every possible service.

## Useful output
A concise editorial assessment, important corrections and any decisions needed from the owner, supported by internal review notes. Make clear what was checked and what still needs attention. The result should make review easier, not make the owner interpret an audit database.

## Organizing inputs and outputs
Read draft, brief, feedback, assets and evidence from the owning folder: agent-files/02-pipeline/<slug>/ or agent-files/apps/seo-workspace/content/<slug>/. Publishing spec and voice/context remain in their canonical Knowledge or agent-files/00-context/ records.

Save internal findings to the existing review note beside the draft, or review.md for a first review. Keep screenshots and link/build verification evidence in a dated review-evidence/ subfolder, linked to the reviewed version and preview/live URL. Attach the owner-facing summary and feedback to the same content record/request, not a second draft or diagnostic app view.

Link original source evidence instead of duplicating research. Preserve earlier reviews for materially different versions. Update agent-files/INDEX.md for durable additions; mark app recovery copies as archives.
