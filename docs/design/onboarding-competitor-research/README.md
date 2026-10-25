# Onboarding questions: competitor research and proposed question set

Date: 2026-10-25. Scope: AI agent builders and adjacent products. LLMOps tools are out of
scope (legacy category for Agenta).

This document has three parts:

1. [What we ask today](#1-what-agenta-asks-today).
2. [What competitors ask](#2-what-competitors-ask): a catalog per product, then a theme
   matrix and the patterns worth copying.
3. [What we should ask](#4-proposed-question-set-for-agenta): a proposed question set,
   with options, what each answer drives, and how to measure it.

## TL;DR

- **Classic persona surveys are disappearing in agent products.** Most developer-leaning
  builders (Dify, Langflow, Flowise, Sim, Mastra) ask nothing at signup. The products that
  still ask (n8n, Lovable, Notion, Beam, Zapier, Make) ask 2-4 one-tap questions.
- **The question moved into the agent chat.** n8n, Activepieces, Dust, Airtable Omni, Beam,
  Copilot Studio and Vellum ask their questions inside the assistant ("Two final questions,
  so I can suggest automations for you"). The answers produce starter prompts or a first
  agent, not only a segment.
- **"What team are you on?" replaced "What is your job title?"** n8n, Airtable and Beam key
  personalization on the team or function, then ask a **per-team use-case question** with
  3-5 options. This pair is the strongest category signal any competitor collects.
- **Apps used is the third key question.** Zapier, n8n, Bardeen and Relay ask it. n8n shows
  app options that depend on the team answer and turns the answer into the agent's first
  task ("what do you usually do in Gmail?").
- **Company size goes to the sales form or to enrichment.** Sim, Cassidy and Relevance keep
  firmographics out of signup; Activepieces and Relevance enrich from the email domain.
- **Referral source is rare.** Only n8n and Airtable (older flow) ask it among the products
  we could verify. n8n added "ChatGPT / LLM" as a channel.
- **Recommendation for Agenta:** replace the role question with a team question, add a
  per-team "first agent" question and a team-aware apps question, keep referral last and
  skippable, and move company size, current tools and team scope to progressive or implicit
  capture. Details in [section 4](#4-proposed-question-set-for-agenta).

## Method and confidence

Five research passes ran in parallel (no-code builders, automation platforms, developer
agent builders, general agents and prompt-to-app builders, survey best practices). Most
vendor sites were not reachable from the research environment, so the evidence has three
levels:

| Label | Meaning |
|---|---|
| **[V]** | Verified from source code (public repo, HEAD around 2026-10-25) or official docs |
| **[S]** | Reported secondhand: a teardown, review, or tutorial seen through search |
| **[NF]** | Not found. We do not guess. |

The open-source products (n8n, Activepieces, Dify, Langflow, Flowise, Sim, Vellum
Assistant, Mastra) are **[V]**: their exact strings come from the repos. Closed-source
products are mostly **[S]**. Exact option labels for Lovable, Manus, Beam, Make and Zapier
were not available; a manual walkthrough with fresh accounts closes that gap (see
[section 6](#6-open-gaps-and-next-steps)).

## 1. What Agenta asks today

`web/mobile/src/features/onboarding/onboardingQuestions.ts`, two one-tap chip questions:

| Step | Question | Options | Drives |
|---|---|---|---|
| `persona` | What best describes you? | Founder, Engineer, Product manager, Designer, Data or ML, Marketing, Sales, Support, Operations, Student, Other | Recommended template category (Engineering, Sales, Support, Knowledge, Ops); PostHog `user_persona_v1` |
| `source` | How did you hear about Agenta? | Google search, ChatGPT or Claude, X, LinkedIn, YouTube, Reddit, GitHub, Hacker News, Friend or colleague, Newsletter or blog, Podcast, Other | PostHog `referral_source_v2` |

The older EE PostHog survey ("Signup 3 - Agents", desktop app) also asked company size
(Solo / 2-10 / 11-50 / 51-200 / 201+), "Have you built AI agents or automations before?"
(Not yet / prototypes / some in production / many at scale) and a multi-select intent
question (Build AI agents / Automate workflows for my team / Evaluate and test LLM apps /
Manage prompts / Monitor in production).

Gaps in today's set:

- The role answer maps to only five template categories, and several roles (Founder,
  Designer, Student, Other) map to none or to a weak guess.
- Nothing tells us **what the user wants the agent to do**, which is the signal we need to
  pick a product category.
- Nothing tells us **which apps** the user works in, although the flow already has a
  connect-apps step (`useSeedToolConnections`, `OnboardingTemplateApps`).
- Answers are stored as display labels. A reworded label breaks analytics continuity.

## 2. What competitors ask

### 2.1 Automation platforms that now sell agents

**n8n [V]** has three layers of questions.

*Layer A, in-app "Customize n8n to you" modal (survey v4).* No close button; fields not
required.

| Key | Question | Options |
|---|---|---|
| `companyType` | What best describes your company? | Software as a service, Ecommerce, Marketing agency / consultancy, Systems integrator, Automation agency, Education, Other, I'm not using n8n for work |
| `companyIndustryExtended` (only if Other) | Which industries is your company in? (multi) | Finance / Insurance, Government, Healthcare, IT, Legal, Managed service provider, Marketing, Media, Manufacturing, Physical retail or services, Real estate / Construction, Security, Telecoms, Other |
| `role` | Which role best describes you? | Business Owner, Customer support, Data Science, Devops, IT, Engineering, Sales and Marketing, Security, Other |
| `devopsAutomationGoal` (Devops/Eng/IT only) | What are you looking to automate? (multi) | CI/CD, Cloud infrastructure orchestration, Data syncing, Incident response, Monitoring and alerting, Reporting, Ticketing systems integrations, Other |
| `marketingAutomationGoal` (Sales & Marketing only) | Which parts of Sales and Marketing? (multi) | Lead generation, enrichment, routing; Customer communication; Actions when lead changes status; Ad campaign management; Reporting; Data syncing; Other |
| `automationBeneficiary` | Who will your automations mainly be for? | Myself, My team, Other teams |
| `companySize` | How big is your company? | Less than 20 people, 20-99, 100-499, 500-999, 1000+, I'm not using n8n for work |
| `reportedSource` | How did you hear about n8n? | Google, Twitter, LinkedIn, YouTube, ChatGPT / LLM, Friend / Word of mouth, Podcast, Event, Other |

*Layer B, n8n Cloud signup form.* "What team are you on?" (Executive/Owner, Support, Product
& Design, Sales, IT, Engineering, Marketing, Other), then one use-case question per team with
three options plus "Something else":

| Team | Use-case options |
|---|---|
| Sales | Lead generation & qualification, Lead nurturing, Market research |
| Marketing | Content creation, Campaigns & audience engagement, Data & insights |
| Support | Customer inquiries, Issue resolution, Inbox & process automation |
| IT | Scam & phishing detection, Data protection, IT service desk |
| Engineering | Data management, Development support, Insights & reporting |
| Product & Design | User & market research, Insights & reporting, Content & asset creation |

It also asks a "which of these do you feel comfortable doing" multi-select (the count of
ticks becomes a coding-skill score) and the apps the user uses. The team × use-case matrix
picks four starter prompts in the AI assistant's empty state (experiment
`093_instance_ai_personalized_prompt_suggestions`); skill plus apps pick three templates.
When answers are missing, it falls back to the four most-used prompts.

*Layer C, assistant onboarding thread (`onboarding-opening.ts`).* New Cloud users land in a
chat: "Hi {{firstName}}, I'm your Assistant… Two final questions, so I can suggest
automations for you."

1. "What team are you on?" (skipped if the signup form answered it).
2. "Which apps do you use most in your {{team}} work?" Multi-select. The options are the
   three tools most typical for that team plus Google Sheets, Gmail, WhatsApp, Telegram
   (for example IT: Slack, Microsoft Teams, Jira, …).
3. "Last one: what do you usually do in {{apps}}?" Free text. The reply becomes the
   assistant's first task.

**Activepieces [V].** Signup asks nothing (UTM captured silently). The first-run chat card
says "Who am I teaming up with?" and asks one fill-in-the-blank sentence: **"I'm a [role] at
[company]"**. The company is pre-filled from the email domain (Clearbit), the role can be
guessed through Apollo. A background job reads the company website and writes 12-20
use-case cards for the chat empty state. Skippable.

**Zapier [S].** 2-3 skippable steps: role, "how many people work in your company", then
"What apps do you use?" (search over 6,000+ apps, at least five suggested). Apps drive
recommended Zap templates. Zapier Agents asks nothing; the user describes the agent and
connects the apps it mentions.

**Make [S].** Welcome page asks role, industry, organization size, experience with
automation, and which part of the work the user wants to automate.

**Airtable [S].** The older wizard asked name, role, "What team are you on?", what you want
to build, and where you heard about Airtable. The current Omni chat asks company, industry
and team (one source adds "preferred AI tool"). An "I'm not sure" path makes Omni ask what
the company does, then it generates a starting base.

**Pipedream [S]** goes straight to the AI builder. **Workato, Tines, Clay**: not researched.

### 2.2 No-code and business-user agent builders

| Product | Questions and steps | Drives | Conf. |
|---|---|---|---|
| **Beam AI** | Stepper: workspace name, industry, team size, role. Then a guided chat where the agent speaks first, the user connects integrations in the chat, and Beam proposes the first agent from the role and test-runs it on sample data. | First agent from role | [S], from Beam changelog (Sep 2026) |
| **Relay.app** (shut down Sep 2026) | Google/Microsoft SSO only, domain auto-join. "How experienced are you with AI and automation tools?" LinkedIn profile URL (an agent enriches it). Team size, apps used. Agent in about 60 s. | Experience sets guidance depth; LinkedIn sets role templates | [S] |
| **Relevance AI** | Data region (US / EU / AU), fixed after creation. Account and company details. Intent: build from scratch / pre-built agents / presentations. Backend agent enriches the profile and classifies the role for lifecycle email. | Region; lifecycle email | Region [V docs], rest [S] |
| **Lindy** | Now a personal assistant. Google/Microsoft sign-in connects mail and calendar, then phone, Slack, invite, tools, first task. "Bring your context" imports what the user told ChatGPT or Claude. Older builder flow had a role pick. | Connected data replaces questions | [V docs] / [S] |
| **Gumloop** | Mandatory Pro trial. Onboarding agent asks name and LinkedIn URL (one source). Goals. 1,000 credits for finishing onboarding. | Tailored onboarding | [S], conflicting |
| **Bardeen** | Use cases and integrations chosen during onboarding (2023 release notes). | Recommended automations | [S] |
| **Cassidy** | Self-serve signup has no survey found. Demo form: company size and free text. First step is knowledge-base setup. | Sales routing | [S] |
| **Taskade** | Workspace name, color, logo; invite. | — | [S] |
| **MindStudio, Lutra, Wordware/Sauna** | No survey found; describe the agent or connect data. | — | [NF] |

### 2.3 Developer-leaning agent builders

| Product | What it asks | Conf. |
|---|---|---|
| **Dify** | No persona survey. "One more step": invite code, interface language, time zone. Skippable four-task tour (Learn lesson, integrations, knowledge, Studio). Create app: template, blank, import, or "Learn Dify". | [V] |
| **Langflow** | No survey. Welcome overlay **"What do you want to build?"** (free text, "Describe your flow…"), sent to the AI assistant as its first message. Or a template (Simple Agent, Vector Store RAG) or Blank Flow. If no model provider: "Let us set things up first". | [V] |
| **Flowise** | Name, email, password; organization on self-host. No survey. | [V] |
| **Sim** | No survey. Lands in a provisioned workspace with a starter workflow. Checklist: connect an integration. **Day-5 email: "what did you expect when you signed up vs. what did you get?"** Demo form only: company size (1-10 … 10,000+), work email required. | [V] |
| **Vellum Assistant** (OSS) | Privacy toggles; hosting (cloud / local); model provider and key; "What should I call you?" (the only required field), last name, role (free text), hobbies (chips). Web research on the user: **"This is what I found about you"**, user removes wrong claims. Five personality sliders. Avatar and name. "Here's what we could do first" suggestions. Connect Google Calendar for a "Day 2 check-in". Data model also has tasks (builds code / writes docs / research / plans work / meetings / life admin), daily tools, **prior assistants used** (ChatGPT, Claude, Manus, Gemini, Copilot, …), tone, GTM cohort. | [V] |
| **Vellum builder** | Describe the goal; the builder asks follow-up questions and builds a draft. | [S] |
| **Voiceflow** | "Hi, what do you want to build?" Older flow: personal or work, design & prototype vs build & publish, coding experience. | [S], low |
| **Botpress** | Scratch or template; objective (e.g. customer support); free-text business description. | [S] |
| **Mastra** | CLI `create-mastra`: model provider, API key, coding-assistant tooling, observability, template. | [V] |
| **LangSmith Fleet** | An onboarding flow exists (`skipOnboarding`, `get_company_info`). Each new agent asks preference questions in chat. | [V] exists, questions [NF] |
| **Stack AI, CrewAI AMP, Retool Agents** | Not found. | [NF] |

### 2.4 General agents, big-tech builders, prompt-to-app builders

| Product | What it asks | Conf. |
|---|---|---|
| **Lovable** | Four-screen wizard, no skip: theme (light/dark with preview), name, "Which role fits you best?" (eight icon cards: Founder, Product, Designer, Engineer, +4), company size (Solo / 2-20 / 21-200 / 200+). Connectors modal before the first build. Then an empty prompt box. | [S], several sources |
| **Manus** | Nine outcome-oriented role cards (what you want done, not job titles), skip present but hidden. Pro trial screen in the middle of the funnel to teach credits. | [S] |
| **Dust** | Email-domain workspace join. Onboarding is a **conversation with the Dust agent** with quick-reply chips; job-type chips; answers saved as `onboarding:*` metadata; the onboarding agent can set up triggers. | [S], from PRs |
| **Notion** | For my team / personal use / school; team size; "What kind of work do you do?"; role; primary use case (multi); import; invite. Answers pick templates and the starter checklist. | [S], consistent |
| **Copilot Studio** | Work email, country/region. "Describe what your agent needs to do", then a guided conversation (tone, knowledge sites, triggers, channels). No persona survey. | [V docs] |
| **Gemini Enterprise** | Company name, seats, region at trial. Personalization: preferred name, role or job title, industry. App toggles. | [V docs] |
| **Claude** | Name, "what should Claude call you", personal vs team. "What best describes your work" in settings. | [S] |
| **Replit** | Name; personal / school / work. "What can Replit help you do?" | [S] |
| **ChatGPT** | Name and birthday. | [S] |
| **Genspark, Bolt, v0, Cursor** | No survey found. | [NF] |

## 3. Cross-product analysis

### 3.1 Theme matrix

Rows are question themes. A product counts only if it asks the theme explicitly during
onboarding.

| Theme | Products that ask it | Notes |
|---|---|---|
| Team / function | n8n (×2), Airtable, Beam, Notion, Zapier, Make, Dust, Gemini | Replacing job title in the newer flows |
| Role / job title | Lovable, Manus (as outcomes), Notion, Activepieces (free text), Vellum (free text), Agenta | |
| Use case / first job, per team | n8n (per team), Make, Bardeen, Notion, Relevance, Botpress | Best category signal |
| "Describe what you want to build" (free text) | Langflow, Voiceflow, Copilot Studio, Botpress, Vellum, MindStudio, Zapier Agents, Agenta (composer) | Doubles as the first action |
| Apps used | Zapier, n8n (team-aware), Bardeen, Relay, Vellum (data model) | Feeds the connect step |
| Company size | n8n, Lovable, Notion, Zapier, Make, Beam, Relay | Sales and plan fit |
| Industry / company type | n8n, Make, Beam, Airtable, Gemini | |
| Experience / skill | Relay, Make, n8n (coding score), Voiceflow | Sets guidance depth |
| Work vs personal vs school | Notion, Replit, Voiceflow, Claude, n8n ("not for work") | Cheapest fork |
| Who the automation is for | n8n (Myself / My team / Other teams) | Team-expansion signal |
| Referral source | n8n, Airtable (older), Agenta | Rare among agent products |
| Prior / current AI tools | Vellum (data model), Airtable Omni (one source) | Competitive intel |
| Identity enrichment (LinkedIn, domain, web) | Relay, Gumloop, Activepieces, Relevance, Vellum | Replaces questions |
| Setup choices (region, model key, hosting) | Relevance, Vellum, Mastra, Langflow, Dify | |

### 3.2 Patterns worth copying

1. **Team, then a per-team use-case question** (n8n). Each team sees only 3-5 relevant
   options plus "Something else". The pair maps straight onto a template catalog and gives
   a clean category distribution.
2. **App options that depend on the team** (n8n). Sales sees HubSpot and Salesforce,
   Engineering sees GitHub and Linear. The follow-up "what do you usually do in {{apps}}?"
   turns the answer into the first task.
3. **Questions inside the agent chat** (n8n, Activepieces, Dust, Beam, Airtable). The agent
   explains why it asks ("so I can suggest automations for you"), and the answers produce
   starter prompts right away. This fits Agenta, where the product is an agent chat.
4. **Skip what you already know** (n8n skips the team step if the signup form answered it;
   Activepieces pre-fills the company from the email domain).
5. **Planned fallbacks** (n8n shows the top-four prompts if the survey is skipped). A
   skipped question never leaves an empty screen.
6. **Outcome cards instead of job titles** (Manus). "What do you want done" segments better
   than "who are you".
7. **A post-use question instead of a signup question** (Sim day-5 email: "what did you
   expect vs. what did you get?").
8. **Ask per agent, not per account** (LangSmith Fleet, Copilot Studio): preference
   questions belong to agent creation.

### 3.3 What the best-practice evidence says

- **Cost of one more one-tap question is small.** Rows.com A/B tested an added use-case
  question: 91% vs 93% completion, inconclusive. involve.me cut six questions to three and
  got 11% more responses. Long tours drop hard (Chameleon: three steps 72%, seven steps
  16%). No vendor publishes a per-question drop-off curve.
- **Personalization by goal or build style beats personalization by job title.** Airtable
  got about a 20% activation lift and segmented by building style, not job function (Lauryn
  Isford, Lenny's Podcast, 2023). Hotjar's expertise question: users who answered were 26%
  more likely to activate (not a clean A/B). Crowd Content's "how do you plan to use the
  product" routing: +15% conversion.
- **Questions with no visible effect get careless answers.** Show the effect (the gallery
  changes) right after the answer.
- **Do not ask what you can infer.** Clearbit-style enrichment of the email domain beats a
  company-size field (Mention: +54% signups after cutting the form to email only).
- **Miro's lesson:** a richer, animated questionnaire lowered conversion; the team went back
  to a minimal flow. Unskippable questions drew public complaints.
- **Version the schema.** Store stable option ids, add `survey_version`, never edit an
  option in place.

## 4. Proposed question set for Agenta

### 4.1 Design principles

- Every question changes something the user sees **in this session**: the templates, the
  apps offered, or the first prompt. If it does not, it moves to progressive capture.
- At most **four taps** before the gallery, plus an optional free-text line. Every question
  is skippable and has a planned fallback.
- Ask for the **job the agent will do**, not only who the user is. This is the data we need
  to pick a category.
- Keep the chip UI we have (one tap, letter keys, at most 12 options).

### 4.2 Core flow (in onboarding)

#### Q1 `team`: "What team are you on?" (replaces `persona`)

Subtitle: "We'll suggest agents built for your work." Single select.

| Option id | Label | Template category |
|---|---|---|
| `founder` | Founder or executive | (asks Q2 with a cross-team list) |
| `engineering` | Engineering | Engineering |
| `product` | Product or design | Engineering / Knowledge |
| `data` | Data or AI/ML | Knowledge |
| `sales` | Sales | Sales |
| `marketing` | Marketing | Sales (marketing set) |
| `support` | Customer support | Support |
| `ops` | Operations (RevOps, BizOps, finance, HR) | Ops |
| `it` | IT or security | Ops |
| `personal` | Not for work: personal projects | (personal list) |
| `student` | Student or researcher | (personal list) |
| `other` | Something else | (top templates) |

Why: team maps to the catalog better than job title (n8n, Airtable, Beam), and the
"Not for work" option replaces a separate work/personal question (n8n). Map the old
`user_persona_v1` labels to these ids for cohort continuity (Engineer → engineering,
Product manager and Designer → product, Data or ML → data, …).

#### Q2 `first_job`: "What should your first agent do?" (new, branched by Q1)

Single select. Each list has 4-5 jobs, then "Something else" (opens a short text field)
and "Just exploring". Each job maps to one or more templates in
`api/oss/src/resources/agent_templates/packages/`.

| Team | Options → templates |
|---|---|
| Engineering | Review pull requests → `pr-reviewer`; Triage issues and bugs → `issue-triage`, `bug-report-router`; Investigate CI failures and errors → `ci-failure-triage`, `error-triage`; Handle on-call and incidents → `incident-responder`, `oncall-briefer`; Write changelogs and digests → `changelog-writer`, `repo-slack-digest`, `dependency-digest` |
| Product or design | Cluster user feedback → `feedback-clusterer`; Answer questions over our docs → `docs-qa`; Write changelogs and updates → `changelog-writer`; Summarize standups and meetings → `standup-summarizer`, `meeting-followup` |
| Data or AI/ML | Answer questions over our data or docs → `knowledge-chatbot`, `docs-qa`; Research a topic and report → (gap); Build a coding or analysis agent → `code-qa`; Write weekly reports → `weekly-report` |
| Sales | Qualify inbound leads → `lead-qualifier`; Find and research prospects → `outbound-prospecting`; Draft outreach → `outreach-drafter`; Keep the CRM up to date → `crm-updater`; Report on the pipeline → `pipeline-digest` |
| Marketing | Write SEO content → `seo-content-agent`; Repurpose content → `content-repurposer`; Draft newsletters → `newsletter-drafter`; Research competitors and market → (gap) |
| Customer support | Draft replies to tickets → `support-reply-drafter`; Triage and route tickets → `support-triage`; Answer customer questions from our docs → `knowledge-chatbot`; Find themes in feedback → `feedback-clusterer` |
| Operations | Write weekly reports → `weekly-report`; Sync data between tools → `cross-tool-sync`; Follow up after meetings → `meeting-followup`; Onboard new hires → `onboarding-buddy` |
| IT or security | Monitor uptime and report → `uptime-reporter`; Handle incidents → `incident-responder`; Answer internal IT questions → `knowledge-chatbot` |
| Founder or executive | One job from each team: Qualify leads, Answer customer questions, Write weekly reports, Review code, Research a market |
| Personal / Student | Research a topic → (gap); Job hunting → `job-hunt-research`; Summarize my email and calendar → (gap); Build a personal assistant → (gap) |

Why: this is the per-team use-case question that n8n uses to pick starter prompts. It
gives the **category distribution** we want (support vs sales vs engineering vs internal
ops) at the job level, and it lets the gallery open on the exact template instead of a
category. The "(gap)" rows are jobs that users may pick but no template covers: their pick
rate tells us which templates to build next.

#### Q3 `apps`: "Which apps do you use most in your work?" (new, multi-select, team-aware)

Show 6-8 apps: the three most typical for the Q1 team, then the common ones (Gmail, Google
Sheets, Slack, Notion), then "Something else". Examples:

| Team | Team-specific apps |
|---|---|
| Engineering | GitHub, Linear, Jira, Sentry |
| Sales | HubSpot, Salesforce, LinkedIn, Apollo |
| Support | Zendesk, Intercom, Freshdesk |
| Marketing | HubSpot, Google Analytics, Webflow, LinkedIn |
| Ops / IT | Jira, Google Drive, Microsoft Teams, Airtable |

Why: the flow already connects tools. The answer pre-selects the apps to connect, filters
the templates to ones whose apps the user has, and tells us which integrations to invest
in. Only offer apps we can connect (Composio keys). Do not ask this question if the user
picked a template that already lists its apps.

#### Q4 `experience`: "Have you built AI agents before?" (new to mobile, from the EE survey)

Single select: Not yet, I'm new to this / I've built prototypes / I run agents in
production / I write agent code (SDK, LangGraph, …).

Why: the answer sets guidance depth (Hotjar +26%, Relay) and shows if we attract
builders or business users, which is the other half of the category decision. The first
three options match the old EE survey, so the cohorts stay comparable. The fourth option
replaces "Running many at scale" and flags developers who may want the SDK path.

#### Q5 `source`: "How did you hear about Agenta?" (keep, last, skippable)

Keep the current options. Add "Event or meetup" and let "Other" open a short text field.
Put it last so it never delays the personalization.

#### Optional free text: "Describe the agent you want" (already in the composer)

The composer path already collects a description. Store the first prompt (with consent
under the privacy policy) and classify it with an LLM into the same `first_job` ids. This
gives a category signal for users who skip Q2 and catches jobs we did not list.

### 4.3 Progressive and implicit capture (not in the onboarding flow)

| Signal | Where to get it | Why not ask up front |
|---|---|---|
| **Company and company size** | Enrich from the work email domain; ask team size only when the user invites a teammate or opens billing | Inferable; sales-only value |
| **Who the agent works for**: Just me / My team / Our customers | Ask in the agent's first chat turn or at deploy (channels, public link) | Strong category signal (internal vs customer-facing), but better answered once the agent exists |
| **What they use today**: ChatGPT/Claude projects, Zapier/Make/n8n, another agent builder (Lindy, Relevance, Gumloop), custom code (LangChain, CrewAI), nothing | Day-3 in-app card or email | Competitive intel; no in-session effect |
| **Build style**: template / describe it / code | Implicit: which path the user takes in the gallery (template tile, composer, scratch) | Already captured by behavior; no need to ask |
| **Expectation gap**: "What did you expect when you signed up vs. what did you get?" | Day-5 email, free-text reply (Sim) | Needs real use first |
| **Agent preferences** (tone, approval rules) | Asked by the agent at creation (Fleet, Copilot Studio) | Per agent, not per account |

### 4.4 Flow change: ask inside the agent (option to test)

The strongest pattern in the research is n8n's and Activepieces' in-chat onboarding. A
test variant for Agenta:

1. Q1 team as a chip screen (as today).
2. Land in the composer. The onboarding agent opens with: "Two quick questions so I can
   suggest agents for you." It asks Q2 (`first_job`) and Q3 (`apps`) as quick-reply chips.
3. Its next turn proposes the matching template, connects the picked apps, and runs a
   first task.

Compare it against the chip-screen flow on activation, not on survey completion.

### 4.5 Analytics and measurement

- **Stable ids.** Store option ids (`engineering`, `review_prs`), not labels. Today
  `knownAnswers` matches labels, so a reworded chip drops old answers.
- **Versioned properties.** Set `user_team_v1`, `first_job_v1`, `apps_v1`,
  `agent_experience_v1`, keep `referral_source_v2`. Add `onboarding_survey_version` to every
  answer event. Never change an option list in place; bump the version.
- **Record skips.** Send `skipped` as an explicit value so skip rate is visible per question.
- **Success metric.** First agent run and week-1 return, per answer segment, against a
  control that sees today's two questions. Survey completion is a guardrail, not the goal.
- **Category report.** A weekly breakdown of `team × first_job`, the "Something else" text,
  and the "(gap)" picks. This is the dataset for the category decision.
- **Rollout.** Add one question at a time behind a PostHog flag: Q2 first (highest signal),
  then Q3, then Q4. Stop adding if completion drops more than about 3 points or activation
  does not move.

## 5. Full question bank (all themes seen)

For reference, every question theme found, with the products that use it and our
recommendation.

| # | Question (example wording) | Seen at | Agenta |
|---|---|---|---|
| 1 | What team are you on? | n8n, Airtable, Beam, Notion, Zapier, Make | **Core (Q1)** |
| 2 | What should your first agent do? / What do you want to automate? (per team) | n8n, Make, Bardeen, Notion, Relevance | **Core (Q2)** |
| 3 | Which apps do you use most? | Zapier, n8n, Bardeen, Relay | **Core (Q3)** |
| 4 | Have you built AI agents before? / How are your coding skills? | Relay, Make, n8n, Voiceflow | **Core (Q4)** |
| 5 | How did you hear about us? | n8n, Airtable | **Keep (Q5)** |
| 6 | Describe what you want to build (free text) | Langflow, Voiceflow, Copilot Studio, Botpress, Vellum | **Composer; classify** |
| 7 | Who will the agent mainly work for? | n8n | Progressive |
| 8 | How big is your company? | n8n, Lovable, Notion, Zapier, Make, Beam | Enrich / at invite |
| 9 | What best describes your company / industry? | n8n, Make, Beam, Gemini, Airtable | Enrich |
| 10 | Work, personal, or school? | Notion, Replit, Voiceflow, Claude | Folded into Q1 |
| 11 | What AI tools do you use today? | Vellum, Airtable Omni | Progressive (day 3) |
| 12 | What should we call you? | Vellum, Claude, Lovable, Gemini | Take from the account |
| 13 | LinkedIn URL / web research on you | Relay, Gumloop, Vellum | No (privacy cost; consider later) |
| 14 | Data region | Relevance | Only if we offer regions |
| 15 | Model provider and API key | Langflow, Vellum, Mastra | Existing credits / key step |
| 16 | Theme (light/dark) | Lovable | No |
| 17 | Personality / tone of the agent | Vellum, Copilot Studio | Per agent, at creation |
| 18 | What did you expect vs. what did you get? | Sim (day-5 email) | Progressive (day 5) |

## 6. Open gaps and next steps

- **Manual walkthroughs** with fresh accounts to get exact labels: Lovable (four missing
  role cards), Manus (nine cards), Beam (industry, team size, role options), Zapier, Make,
  Gumloop, Relevance AI, Voiceflow, Botpress, Stack AI, Retool Agents, CrewAI AMP. Save
  screenshots next to this file.
- **Not researched:** Workato, Tines, Clay.
- **Template gaps** surfaced by Q2: competitor and market research, personal email and
  calendar assistant, general research agent. Decide whether to add templates before or
  after the first data comes in.
- **Decision needed:** chip-screen flow (4.2) vs in-chat flow (4.4) for the first test.

## Sources

Verified from source (public repos, around 2026-10-25):

- n8n: `packages/frontend/editor-ui/src/features/settings/users/components/PersonalizationModal.vue`,
  `packages/frontend/@n8n/i18n/src/locales/en.json`,
  `packages/cli/src/modules/instance-ai/onboarding-opening.ts`,
  `experiments/instanceAiPersonalizedPromptSuggestions/` (github.com/n8n-io/n8n)
- Activepieces: `sign-up-request.ts`, `onboarding-welcome.tsx`, `onboarding-question-card.tsx`,
  `chat-personalization.md` (github.com/activepieces/activepieces)
- Dify: `web/app/signin/one-more-step.tsx`, `web/i18n/locales/en-US/onboarding.json` (github.com/langgenius/dify)
- Langflow: `src/frontend/src/locales/en.json`, `stores/flowBuilderWelcomeStore.ts`
- Flowise: `packages/ui/src/views/auth/register.jsx`
- Sim: `apps/sim/app/(auth)/signup/signup-form.tsx`, `components/emails/auth/onboarding-followup-email.tsx`, `lib/api/contracts/demo-requests.ts`
- Vellum Assistant: `clients/web/src/i18n/locales/en/onboarding.json`, `clients/web/src/domains/onboarding/`
- Mastra: `packages/cli/src/commands/init/utils.ts`
- LangSmith docs: `langchain-ai/docs` `src/langsmith/fleet/quickstart.mdx`, `audit-logs.mdx`

Official docs and changelogs:

- Beam: https://beam.ai/resources/changelog/agent-templates-guided-onboarding
- Relevance AI: https://relevanceai.com/docs/admin/security, https://relevanceai.com/blog/lifecycle-marketing-agent-how-relevance-ai-personalized-onboarding-for-every-user
- Lindy: https://docs.lindy.ai/start-here/quickstart
- Copilot Studio: https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-first-bot
- Gemini Enterprise: https://cloud.google.com/gemini/enterprise/docs/configure-personalization
- Bardeen: https://www.bardeen.ai/release-notes
- Dust PRs: https://github.com/dust-tt/dust/pull/34940, /34000, /34949

Secondhand (teardowns, reviews):

- Lovable, Manus: https://aiuxplayground.com/teardowns/lovable/onboarding/, https://aiuxplayground.com/teardowns/compare/ai-onboarding-first-value/
- Notion: https://pageflows.com/post/desktop-web/onboarding/notion/, https://theuxologist.com/case-studies/how-notion-encourages-onboarding-through-progressive-profiling
- Zapier: https://pageflows.com/post/desktop-web/onboarding/zapier/
- Make: https://docs.peopledatalabs.com/docs/sign-up-for-a-makecom-account
- Airtable: https://www.candu.ai/blog/airtables-best-wizard-onboarding-flow, https://www.candu.ai/blog/airtable-omni-teardown-review
- Relay.app: https://productled.com/teardowns/relay-app
- Gumloop: https://forum.gumloop.com/t/onboarding-issue/3646, https://agentaya.com/ai-review/gumloop/
- Voiceflow: https://www.chatimize.com/reviews/voiceflow/
- Botpress: https://botpress.com/docs/learn/get-started/quick-start
- Replit: https://hostadvice.com/ai-app-builders/replit-review/

Best-practice evidence:

- Rows.com A/B test: https://rows.com/blog/post/experimenting-with-questions-and-hints-in-the-user-onboarding
- involve.me: https://www.involve.me/blog/case-study-how-we-use-an-onboarding-survey-in-a-saas-product
- Chameleon benchmarks: https://www.chameleon.io/benchmark-report-2022
- Airtable activation (Lauryn Isford): https://www.lennysnewsletter.com/p/mastering-onboarding-lauryn-isford
- Hotjar: https://appcues.com/customer-stories/how-hotjar-increased-installations-by-26-with-a-personalized-approach-to-onboarding
- Crowd Content: https://appcues.com/examples/crowd-content-choose-your-own-adventure-onboarding
- Miro: https://www.growthunhinged.com/p/the-evolution-of-miros-user-onboarding
- Clearbit / Mention: https://clearbit.com/blog/how-mention-increased-their-conversion-by-54-using-clearbit
- Refine Labs attribution: https://www.refinelabs.com/blog/attribution-mirage
- PostHog versioning: https://posthog.com/docs/product-analytics/best-practices
