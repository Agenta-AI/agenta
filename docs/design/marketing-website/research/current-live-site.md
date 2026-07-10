# Current Live Site Capture — agenta.ai

Captured: 2026-06-25. Source: Framer-hosted site at https://agenta.ai.
Research method: Jina Reader (JS-rendered markdown), WebFetch, WebSearch.

---

## Summary / Key Facts

- **"Book a demo" destination:** https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30 (Calendly, 30-minute slot)
- **"Get started" / "Start for free" destination:** https://cloud.agenta.ai/ (the hosted cloud app)
- **"Read the docs" destination:** https://docs.agenta.ai/
- **Enterprise "Talk to us" destination:** https://cal.com/mahmoud-mabrouk-ogzgey/demo (same Calendly, no duration param)
- **Landing page video embed:** None. The hero uses a static SVG product screenshot. No YouTube, Loom, or Wistia embed exists anywhere on the current live homepage.
- **No "Sign in" link** is visible in the nav bar. Authentication occurs via cloud.agenta.ai after clicking "Get started".
- **Blog** is part of the Framer site at https://agenta.ai/blog (not a separate subdomain). Post URLs follow the pattern `/blog/[slug]`. No author pages found.
- **Second site ("Gentlet.ai"):** No site matching this name was found. A likely candidate is the old Agenta Framer staging site at https://simplest-researchers-303954.framer.app/ (published ~May 2024), which is an earlier design of agenta.ai — see Section 7.

---

## 1. Navigation Bar

### Primary nav items (left side)

| Label | Destination | Notes |
|-------|-------------|-------|
| Pricing | https://agenta.ai/pricing | Direct page link |
| Docs | https://agenta.ai/docs | Docs site (hosted within Framer domain) |
| Blog | https://agenta.ai/blog | Direct page link |
| Resources | dropdown | Items: Tutorial, Changelog, Roadmap (see dropdown detail below) |
| Community | dropdown | Items: GitHub, Slack, YouTube, LinkedIn, X/Twitter |

### Resources dropdown items

| Label | Destination |
|-------|-------------|
| Tutorial | https://agenta.ai/docs/tutorials/cookbooks/capture-user-feedback |
| Changelog | https://agenta.ai/docs/changelog/main |
| Roadmap | https://agenta.ai/docs/roadmap |

### Community dropdown items

| Label | Destination |
|-------|-------------|
| GitHub | https://github.com/agenta-ai/agenta |
| Slack | https://join.slack.com/t/agenta-hq/shared_invite/zt-2yewk6o2b-DmhyA4h_lkKwecDtIsj1AQ |
| YouTube | https://www.youtube.com/@agentaAI |
| LinkedIn | https://www.linkedin.com/company/agenta-ai/ |
| X (Twitter) | https://twitter.com/agenta_ai |

### Right-side CTAs

| Label | Destination |
|-------|-------------|
| Book a demo | https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30 |
| Get started | https://cloud.agenta.ai/ |

---

## 2. Landing Page (https://agenta.ai/)

### Hero section

- **Headline:** "The open-source LLMOps platform" (animated/stacked text)
- **Subcopy:** "Build reliable LLM apps together with integrated prompt management, evaluation, and observability."
- **Feature pills below headline:** Playground · Evaluation · Observability
- **Hero visual:** Static SVG product screenshot (framerusercontent.com image, no video)
- **Hero CTAs:**

| Label | Destination |
|-------|-------------|
| Get started | https://cloud.agenta.ai/ |
| Read the docs | https://docs.agenta.ai/ |

### Sections top to bottom

1. **Hero** — headline + subcopy + feature pills + static product screenshot
2. **"THE PROBLEM — Why Most AI Teams Struggle"** — 5 bulleted pain points (prompts scattered in Slack/Sheets/email; siloed PMs/devs/experts; vibe-testing to production; no visibility on experiments; debugging feels like guesswork)
3. **"the solution — Your single source of truth for whole team"** — 4 pillars: Centralize / Collaborate / Create evaluations / Monitor production systems
4. **"Experiment — Iterate your prompts with the whole team"** — 4 sub-features each with a screenshot:
   - Unified playground (compare prompts + models side-by-side)
   - Complete version history
   - Model agnostic (best model from any provider)
   - Unified playground [second card] (save production errors to test sets)
5. **"Evaluate — Replace your guesswork with evidence"** — 4 sub-features:
   - Automated evaluation (systematic experiments + results tracking)
   - Integrate any evaluator (LLM-as-judge / built-in / code evaluators)
   - Evaluate full trace (intermediate agent steps, not just final output)
   - Human evaluation (domain expert feedback in evaluation workflow)
6. **"Observe — Debug your AI systems and gather user feedback"** — 4 sub-features:
   - Trace every request (find exact failure points)
   - Annotate traces (team + user feedback)
   - Turn any trace into a test (closing the feedback loop)
   - Monitor performance + detect regressions (live, online evaluations)
7. **"Collaborate — Bring PMs, experts, and devs into one workflow"** — 3 sub-features + a large product screenshot:
   - A UI for your experts (domain experts edit prompts without code)
   - Evals for everyone (PMs run evaluations from the UI)
   - Full API and UI parity
8. **CTA band — "Ship reliable agents faster with Agenta"** — subcopy repeats hero tagline, large product screenshot, two buttons:

   | Label | Destination |
   |-------|-------------|
   | Start building | https://cloud.agenta.ai/ |
   | Read the docs | https://docs.agenta.ai/ |

9. **Footer** (see Section 6)

### Social proof / customer logos

No customer logo strip or testimonial section was rendered by Jina or WebFetch. This section may be hidden behind JS that Jina could not render, or may not exist on the current site.

### Video / demo embed

No video embed exists on the homepage. The hero uses a static SVG image. No YouTube, Loom, Wistia, or self-hosted video player was found anywhere on the page.

---

## 3. Demo / Get-Started Flow

| Entry point | Destination | Notes |
|-------------|-------------|-------|
| "Book a demo" (nav) | https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30 | Calendly 30-min meeting |
| "Get started" (nav) | https://cloud.agenta.ai/ | Cloud app signup/login |
| "Get started" (hero) | https://cloud.agenta.ai/ | Same |
| "Start for free" (pricing Hobby plan) | https://cloud.agenta.ai/ | Same |
| "Upgrade now" (pricing Pro + Business) | https://cloud.agenta.ai/ | Same (billing inside app) |
| "Talk to us" (pricing Enterprise) | https://cal.com/mahmoud-mabrouk-ogzgey/demo | Calendly (no duration param) |
| "Book a call" (pricing FAQ band) | https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30 | Same as nav "Book a demo" |
| "Start building" (bottom CTA band) | https://cloud.agenta.ai/ | Same |
| "Read the docs" | https://docs.agenta.ai/ | Docs site |

---

## 4. Pricing Page (https://agenta.ai/pricing)

### Plan structure

| Plan | Price | Included seats | Included traces | Included evaluations | Retention | CTA | CTA destination |
|------|-------|----------------|-----------------|----------------------|-----------|-----|-----------------|
| Hobby | Free/month | 2 | 5k/month | 20/month | 30 days | Start for free | https://cloud.agenta.ai/ |
| Pro | $49/month | 3 (+$20/seat, up to 10) | 10k/month (+$5/10k) | Unlimited | 90 days | Upgrade now | https://cloud.agenta.ai/ |
| Business | $399/month | Unlimited | 1M/month (+$5/10k) | Unlimited | 365 days | Upgrade now | https://cloud.agenta.ai/ |
| Enterprise | Custom | Unlimited | Custom | Unlimited | Custom | Talk to us | https://cal.com/mahmoud-mabrouk-ogzgey/demo |

### Monthly/annual toggle

Not visible in the fetched content. The page shows only monthly prices with no toggle indicator.

### Key feature differences (from the comparison table)

- **Role-based Access Control:** Business + Enterprise only
- **SOC2 reports:** Business + Enterprise only
- **Enterprise SSO:** Enterprise only
- **HIPAA BAA (soon):** Enterprise only
- **Bring Your Own Cloud:** Enterprise only
- **Enterprise self-hosting:** Enterprise only
- **Private Slack Channel:** Business + Enterprise
- **Dedicated Support Engineer:** Enterprise only

### Pricing page bottom CTAs

| Label | Destination |
|-------|-------------|
| Book a call (FAQ band) | https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30 |
| Start building | https://cloud.agenta.ai/ |
| Read the docs | https://docs.agenta.ai/ |

---

## 5. Blog (https://agenta.ai/blog)

- **Location:** Hosted within the Framer site at agenta.ai/blog (not a subdomain or external CMS)
- **URL pattern for posts:** `https://agenta.ai/blog/[slug]` (e.g., `/blog/git-vs-prompt-management-tools`)
- **Author pages:** None found. Posts do not display a byline or link to an author profile. No `/blog/author/` URL pattern exists.
- **Featured post treatment:** No featured/pinned post at top. Grid layout, chronological descending order.
- **Categories:** Posts carry a category pill (e.g., "Engineering", "Article") but these are not clickable filter links in the Jina-rendered output.

### Sample posts (most recent as of capture)

| Category | Title | Date | URL |
|----------|-------|------|-----|
| Engineering | Git vs. Prompt Management Tools: Which Should You Use? | Feb 11, 2026 | https://agenta.ai/blog/git-vs-prompt-management-tools |
| Engineering | CI/CD for LLM Prompts: How to Build a Prompt Deployment Pipeline | Feb 11, 2026 | https://agenta.ai/blog/cicd-for-llm-prompts |
| Engineering | Prompt Drift: What It Is and How to Detect It | Feb 11, 2026 | https://agenta.ai/blog/prompt-drift |
| Engineering | Prompt Management for Non-Engineers | Feb 11, 2026 | https://agenta.ai/blog/prompt-management-for-non-engineers |
| Engineering | Prompt Versioning: The Complete Guide | Feb 11, 2026 | https://agenta.ai/blog/prompt-versioning-guide |
| Article | Building the Data Flywheel | Dec 19, 2025 | https://agenta.ai/blog/building-the-data-flywheel-how-to-use-production-data-to-improve-your-llm-application |

---

## 6. Footer

Footer columns appear on all pages. Order: social icons row → trust badge → Product | Company | Resources | Legal | copyright.

### Social icons (above columns)

| Platform | URL |
|----------|-----|
| GitHub | https://github.com/agenta-ai/agenta |
| Slack | https://join.slack.com/t/agenta-hq/shared_invite/zt-2yewk6o2b-DmhyA4h_lkKwecDtIsj1AQ |
| LinkedIn | https://www.linkedin.com/company/agenta-ai/ |
| YouTube | https://www.youtube.com/@agentaAI |
| Twitter/X | https://twitter.com/agenta_ai |

### Trust badge

SOC2/trust center badge image links to: https://trustcenter.agenta.ai/

### Product column

| Label | URL |
|-------|-----|
| Prompt Engineering | https://agenta.ai/docs/prompt-engineering/quick-start |
| Evaluation | https://agenta.ai/docs/evaluation/evaluation-from-ui/quick-start |
| Human annotation | https://agenta.ai/docs/evaluation/human-evaluation/quick-start |
| Deployment | https://agenta.ai/docs/prompt-engineering/managing-prompts-programatically/deploy |
| Observability | https://agenta.ai/docs/observability/overview |

### Company column

| Label | URL |
|-------|-----|
| Home | https://agenta.ai/ |
| Pricing | https://agenta.ai/pricing |
| Contact | https://agenta.ai/imprint |

### Resources column

| Label | URL |
|-------|-----|
| Docs | https://agenta.ai/docs/ |
| Tutorial | https://agenta.ai/docs/tutorials/cookbooks/capture-user-feedback |
| Changelog | https://agenta.ai/docs/changelog/main |
| Roadmap | https://agenta.ai/docs/roadmap |
| Blog | https://agenta.ai/blog |
| Status | https://status.agenta.ai/ |

### Legal column

| Label | URL |
|-------|-----|
| Imprint | https://agenta.ai/imprint |
| Terms of services | https://agenta.ai/docs/administration/security/terms-of-service |
| Privacy Policy | https://agenta.ai/docs/administration/security/privacy-policy |
| DPA | https://agenta.ai/docs/administration/security/dpa |
| Trust Center | https://trustcenter.agenta.ai/ |
| Privacy Policy (Termly) | https://app.termly.io/policy-viewer/policy.html?policyUUID=ce8134b1-80c5-44b7-b3b2-01dba9765e59 |

### Copyright

`Copyright © 2020 - 2060 Agentatech UG`

---

## 7. Second Site ("Gentlet.ai")

No site called "Gentlet.ai" was found via web search. Multiple searches for "Gentlet.ai", "Gentlet AI platform", and variants returned no matching result.

The most likely candidate for the site the user is recalling is the **old Agenta Framer staging/preview site**:

**URL:** https://simplest-researchers-303954.framer.app/
**Published:** ~May 2024 (much older design than the current live site)

This older site has a noticeably different structure:

- **Hero headline:** "LLM Platform — Collaborate on prompts, evaluate, and deploy LLM apps with confidence"
- **Hero visual:** An animated .gif product demo (not a static screenshot and not a video embed)
- **Nav bar:** Pricing · Documentation · Slack · Changelog · Careers · Blog (no Resources/Community dropdowns; includes "Careers" which is gone from the current site)
- **Sections:** Developer-First Platform, Playground, Automatic Evaluation, Human Feedback, Model and Framework Agnostic, Monitor and Debug (Coming Soon), FAQ
- **No "Book a demo" CTA** in the nav; no Calendly link
- No footer social links captured

This is the predecessor design. If the user is remembering a separate second site with a different brand name, it was not publicly indexed at the time of this capture.

---

## Notes for the Rebuild

1. The Calendly link (`cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30`) is the single most critical external URL to preserve — it is used for both the nav "Book a demo" and the pricing FAQ CTA.
2. All plan upgrade CTAs point to `cloud.agenta.ai` (the app), not to a Stripe checkout URL directly. Billing happens inside the app after signup.
3. The docs domain is `docs.agenta.ai` but the Framer site also mirrors docs under `agenta.ai/docs` (appears to redirect or proxy).
4. The status page is an external service at `status.agenta.ai`.
5. There is no landing page video. If the redesign adds one, it will be a net new element.
6. The blog has no author pages or tag/category filter pages. All posts live at `/blog/[slug]`.
