# Onboarding questions: competitor research and proposed question set

Date: 2026-10-25, updated 2026-10-26. Scope: AI agent builders and adjacent products. LLMOps tools are out of
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
- **Referral source is rare and comes last.** n8n, Airtable (older flow), Relevance AI,
  Clay and Make (one tutorial) ask it. n8n added "ChatGPT / LLM" as a channel.
- **Today's `/m` flow** (behind `NEXT_PUBLIC_AGENTA_ONBOARDING_FLOW_ENABLED`) asks role
  and referral, both required in practice, and does not record two free signals it already
  sees: how the user runs models and template vs scratch. Review in
  [section 1.1](#11-review-of-the-m-questions-against-the-research), short list of changes
  in [section 4.0](#40-short-list-what-to-change-in-m).
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

| **[C]** | Matched across independent public UI clones (repos that copy the product's screens), or a public transcription of the settings page. Medium confidence. |

The open-source products (n8n, Activepieces, Dify, Langflow, Flowise, Sim, Vellum
Assistant, Mastra) are **[V]**: their exact strings come from the repos. Closed-source
products are **[S]** or **[C]**.

### How we got data on closed-source products

The research container cannot open vendor sites, teardown sites, or the Wayback Machine.
A second pass used the routes that were open:

1. **Extended web search with quoted labels.** Searching for known labels ("Founder"
   "Designer" "Engineer" lovable) finds pages that list the rest.
2. **Non-English tutorials.** Japanese, French and Spanish tutorials often transcribe every
   signup screen. They gave the Zapier, Make and Relay field lists.
3. **GitHub code search for UI clones.** Public repos that copy a product's onboarding
   carry its strings. When three clones agree (Lovable roles) or two do (Notion work
   types), the labels are likely right. Public transcriptions of settings pages gave
   Claude's work-function list.
4. **Published npm packages** (Voiceflow SDKs): checked, no onboarding strings.

Routes that need access we do not have, in order of value:

1. **Network allowlist + JS bundle analysis.** Allow the product domains in the cloud
   environment network policy. The single-page apps ship their onboarding strings in the
   client JavaScript, so we can extract the exact questions without an account. The
   Wayback Machine (`web.archive.org`) gives older versions of the same bundles.
2. **Browser walkthroughs.** Sign up with test accounts through a real browser (Claude in
   Chrome or computer use on a team machine) and save screenshots.
3. **Manual walkthroughs** by the team, with the screenshot list in
   [section 6](#6-open-gaps-and-next-steps).

## 1. What Agenta asks today (`/m` onboarding)

The flow lives in `web/mobile/src/features/onboarding/` and runs at
`/m/w/<workspace>/p/<project>/onboarding`. It is behind the flag
`NEXT_PUBLIC_AGENTA_ONBOARDING_FLOW_ENABLED` (container env `AGENTA_ONBOARDING_FLOW_ENABLED`,
default `false`). With the flag on, a new SuperTokens user gets a pending mark and Home
sends them to the flow. Steps, in order (`onboardingRoute.ts`):

1. `persona`: a question (below).
2. `source`: a question (below).
3. `credits`: "How your agents run". Agenta credits, ChatGPT subscription, Claude
   subscription, or an API key.
4. `templates`: "Create your first agent". The template gallery (Recommended ordered by
   the persona answer), or "New agent" from scratch (name, icon and color, first message).

The two questions in `onboardingQuestions.ts` are one-tap chips:

| Step | Question | Options | Drives |
|---|---|---|---|
| `persona` | What best describes you? | Founder, Engineer, Product manager, Designer, Data or ML, Marketing, Sales, Support, Operations, Student, Other | Recommended template category (Engineering, Sales, Support, Knowledge, Ops); PostHog `user_persona_v1` |
| `source` | How did you hear about Agenta? | Google search, ChatGPT or Claude, X, LinkedIn, YouTube, Reddit, GitHub, Hacker News, Friend or colleague, Newsletter or blog, Podcast, Other | PostHog `referral_source_v2` |

The older EE PostHog survey ("Signup 3 - Agents", desktop app) also asked company size
(Solo / 2-10 / 11-50 / 51-200 / 201+), "Have you built AI agents or automations before?"
(Not yet / prototypes / some in production / many at scale) and a multi-select intent
question (Build AI agents / Automate workflows for my team / Evaluate and test LLM apps /
Manage prompts / Monitor in production).

### 1.1 Review of the `/m` questions against the research

**`persona`, "What best describes you?"**

| Check | Finding |
|---|---|
| Question type | Job title. Newer competitor flows ask the **team** ("What team are you on?": n8n, Airtable, Beam) or the **outcome** (Manus), and Airtable measured that goal or build style beats job function for activation. |
| Mapping to templates | The catalog has 31 templates: engineering 10, sales 6, knowledge 5, support 4, ops 4, career 1, seo 1. The persona map is loose: Founder → Ops, Product manager and Designer → Engineering, Marketing → Sales (no marketing template is in the sales set; the content templates sit in knowledge and seo). Student and Other map to nothing. |
| Options | 11 options. Close to Lovable's 8 cards (Founder, Product, Designer, Engineer, Consultant, Marketing / Sales, Operations, Other). Missing compared with peers: Consultant or agency (Lovable, n8n, Make), IT or security (n8n), Executive (Notion, n8n), and a "not for work" choice (n8n, Notion, Replit). |
| Signal for the category decision | Weak. It says who the user is, not what the agent should do. |

**`source`, "How did you hear about Agenta?"**

| Check | Finding |
|---|---|
| Options | Good. It already has "ChatGPT or Claude", the channel n8n added ("ChatGPT / LLM"). Missing: "Event or meetup" (n8n). "Other" has no text field. |
| Position | Step 2, before the user sees any value. Few agent products ask it at all (n8n, Airtable, Relevance AI, Make in one tutorial, Clay). Where they ask, it is last. |

**Flow-level findings**

- **The questions are required in practice.** A later step opens only when every earlier
  question is answered (`isStepOpen`). The only way out is "Skip for now", which skips
  the whole flow. Competitors that ask more questions make each one skippable (Zapier,
  Make, n8n's card has "Something else").
- **Answers are stored as display labels.** `knownAnswers` keeps an answer only if a chip
  with that exact label still exists, so a reworded chip drops old answers.
- **Two strong signals are not captured as properties.** The `credits` step shows how the
  user pays for models (Agenta credits, ChatGPT plan, Claude plan, own key). The
  `templates` step shows the build style (template vs scratch) and which template. Neither
  is set as a person property today; `onboarding_create_clicked` carries no template key.
  These answer two questions we would otherwise have to ask.
- **Nothing tells us what the agent should do or which apps the user works in.** The
  connect-apps logic exists (`onboardingConfiguration`, `OnboardingTemplateApps`) but no
  question feeds it.

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

**Zapier [S].** "About you" (job, "how many people work in your company"), then "What apps
do you use?" (search over 6,000+ apps, at least five suggested). All skippable; Japanese
2026 tutorials confirm the same three fields. Apps drive recommended Zap templates. Option
lists: not found. Zapier Agents asks nothing: new agent → instructions or template →
"Connect your apps" (the apps named in the instructions, skippable) → trigger → test →
publish.

**Make [S].** Signup sets an organization name and a data region (EU / US). The welcome
page asks role, industry, organization size, automation experience, and what the user
wants to automate (French guide). A Spanish guide adds "What will you use Make for?
Personal / Business / Agency" and team size; another adds how you found Make. Option
lists: not found.

**Airtable [S].** The older wizard asked name, role, "What team are you on?", what you want
to build, and where you heard about Airtable. The current Omni chat asks company, industry
and team (one source adds "preferred AI tool"). An "I'm not sure" path makes Omni ask what
the company does, then it generates a starting base.

**Clay [S].** Workspace name, team type, CRM, tools used, and attribution. Then "How
would you like to get started?": find and enrich people, find and enrich accounts,
generate pre-meeting notes, AI outbound messaging, automate account research (Supademo
teardown). This is a "first job" question like n8n's.

**Tines [S].** After signup, "a few setup steps to personalize your experience, such as
selecting the tools you use and your goals". Options not found.

**Pipedream [S]** goes straight to the AI builder. **Workato [V docs]** asks name, work
email and password only.

### 2.2 No-code and business-user agent builders

| Product | Questions and steps | Drives | Conf. |
|---|---|---|---|
| **Beam AI** | Stepper: workspace name, industry, team size, role. Then a guided chat where the agent speaks first, the user connects integrations in the chat, and Beam proposes the first agent from the role and test-runs it on sample data. | First agent from role | [S], from Beam changelog (Sep 2026) |
| **Relay.app** (shut down Sep 2026) | Google/Microsoft SSO only, domain auto-join. "How experienced are you with AI and automation tools?" LinkedIn profile URL (an agent enriches it). Team size, apps used. Agent in about 60 s. | Experience sets guidance depth; LinkedIn sets role templates | [S] |
| **Relevance AI** | Data region (US / EU / AU), fixed after creation. A review (Sep 2026) lists "company name, size, department, role, goals (mine was 'I want to build agents'), technical skill level, and how I found the platform". Intent: build from scratch / pre-built agents / presentations. Backend agent enriches the profile and classifies the role for lifecycle email. | Region; lifecycle email | Region [V docs], rest [S] |
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
| **Voiceflow** | "What do you want to build?" on the signup page; templates such as customer support, lead qualification, voice assistant. Older flow: personal or work, design & prototype vs build & publish, coding experience (none / a little / a lot). | [S] |
| **Botpress** | Scratch or template; what kind of bot (objective, e.g. customer support); describe the project **or paste your website URL**, and Botpress builds the bot from it. | [S] |
| **Stack AI** | Name, email, password; then "quick start" vs "custom builder". | [S] |
| **Retool** | "Tell us about yourself": name, company name, one onboarding question (wording not found), invite collaborators. | [S] |
| **Mastra** | CLI `create-mastra`: model provider, API key, coding-assistant tooling, observability, template. | [V] |
| **LangSmith Fleet** | An onboarding flow exists (`skipOnboarding`, `get_company_info`). Each new agent asks preference questions in chat. | [V] exists, questions [NF] |
| **CrewAI AMP** | Not found. | [NF] |

### 2.4 General agents, big-tech builders, prompt-to-app builders

| Product | What it asks | Conf. |
|---|---|---|
| **Lovable** | Four screens with progress dots, no skip: "Pick your style" (Light / Dark with preview), "What's your name?", **"Which role fits you best?"** (Founder, Product, Designer, Engineer, Consultant, Marketing / Sales, Operations, Other; auto-advance), **"How many people work at your company?"** (Solo / 2 - 20 / 21 - 200 / 200+). End screen "Ready to build, <Name>?". Connectors modal before the first build. No use-case or referral question. | Structure [S]; role labels [C] (three clones agree); size [S] confirmed |
| **Manus** | Nine outcome-oriented role cards (what you want done, not job titles), skip present but hidden. Pro trial screen in the middle of the funnel to teach credits. | [S] |
| **Dust** | Email-domain workspace join. Onboarding is a **conversation with the Dust agent** with quick-reply chips; job-type chips; answers saved as `onboarding:*` metadata; the onboarding agent can set up triggers. | [S], from PRs |
| **Notion** | "How are you planning to use Notion?" (For work / For personal life / For school; older: For my team / For personal use / For school). **"What kind of work do you do?"** (18 options: Engineering, Educator, Product Management, Operations, Customer Service, Founder / CEO, Internal Communication, Creative, Product Design, Sales, Finance, Project / Program Management, Marketing, Human Resources, Student, IT Admin, Knowledge Management, Other). **"What's your role?"** (Executive (C-level / VP), Department lead, Team manager, Team member, Solo-preneur / Freelancer, Using Notion just for myself). Company size (buckets changed over time, e.g. 1-49 / 50-99 / 100-299 / 300-999 / 1000-5000 / 5000+). Use case, import, invite. Answers pick templates and the starter checklist. Notion AI has no wizard. | Structure [S]; option lists [C] (two clones agree on work types) |
| **Copilot Studio** | Work email, country/region. "Describe what your agent needs to do", then a guided conversation (tone, knowledge sites, triggers, channels). No persona survey. | [V docs] |
| **Gemini Enterprise** | Company name, seats, region at trial. Personalization: preferred name, role or job title, industry. App toggles. | [V docs] |
| **Claude** | Name, "What should Claude call you?", personal vs team. **"What best describes your work?"** in settings (Sep 2026: Product management, Engineering, Human resources, Finance, Marketing, Sales, Operations, Data science, Design, Legal, Scientist, Student, Founder, Healthcare, Writer, Educator, Consultant, Researcher, Software engineer, Other). | [S]; work list [C] |
| **Replit** | Name; personal, school, or work. ("What can Replit help you do?" is a docs heading, not a question.) | [S] |
| **ChatGPT** | Name and birthday. | [S] |
| **Bolt** | No survey; straight to "What should we build today?" | [S] |
| **Genspark, v0, Cursor** | No survey found. | [NF] |

## 3. Cross-product analysis

### 3.1 Theme matrix

Rows are question themes. A product counts only if it asks the theme explicitly during
onboarding.

| Theme | Products that ask it | Notes |
|---|---|---|
| Team / function | n8n (×2), Airtable, Beam, Notion, Make, Dust, Gemini, Clay, Relevance (department) | Replacing job title in the newer flows |
| Role / job title | Lovable, Manus (as outcomes), Notion, Zapier, Claude, Activepieces (free text), Vellum (free text), Agenta | |
| Use case / first job, per team | n8n (per team), Clay, Make, Bardeen, Notion, Relevance, Tines, Botpress | Best category signal |
| "Describe what you want to build" (free text) | Langflow, Voiceflow, Copilot Studio, Botpress, Vellum, MindStudio, Zapier Agents, Agenta (composer) | Doubles as the first action |
| Apps used | Zapier, n8n (team-aware), Bardeen, Relay, Vellum (data model) | Feeds the connect step |
| Company size | n8n, Lovable, Notion, Zapier, Make, Beam, Relay | Sales and plan fit |
| Industry / company type | n8n, Make, Beam, Airtable, Gemini | |
| Experience / skill | Relay, Make, n8n (coding score), Voiceflow | Sets guidance depth |
| Work vs personal vs school | Notion, Replit, Voiceflow, Claude, n8n ("not for work") | Cheapest fork |
| Who the automation is for | n8n (Myself / My team / Other teams) | Team-expansion signal |
| Referral source | n8n, Airtable (older), Relevance, Make (one tutorial), Clay, Agenta | Rare among agent products; asked last |
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

### 4.0 Short list: what to change in `/m`

Three new questions, one rework, and three free signals. The rest of section 4 gives the
full options and the reasons.

| # | Change | Question | Type | Why (evidence) |
|---|---|---|---|---|
| 1 | **Add** after `persona` | **"What should your first agent do?"** Options depend on the team (4-5 jobs + "Something else" + "Just exploring") | Single, skippable | The category signal we need. n8n (per-team use case), Clay ("How would you like to get started?"), Make, Relevance ("goals") ask it. Opens the gallery on the matching template. |
| 2 | **Add** | **"Which apps do you use most in your work?"** Options depend on the team | Multi, skippable | Zapier, n8n, Tines, Clay, Bardeen ask it. Feeds the connect-apps logic we already have, and ranks the integrations to invest in. |
| 3 | **Add** (A/B) | **"Who will your agent work for?"** Just me / My team / Our customers | Single, skippable | n8n asks it ("Myself / My team / Other teams"). It splits internal assistants from customer-facing agents, the main product-category fork. |
| 4 | **Rework** `persona` | **"What team are you on?"** instead of "What best describes you?" | Single | n8n, Airtable, Beam, Clay key on the team. Add Consultant or agency and IT; fold Student into "Not for work". |
| 5 | **Keep** `source`, move it after the first agent is created | "How did you hear about Agenta?" + "Event or meetup", "Other" opens a text field | Single, skippable | Rare in agent products; where asked, it is last. |
| 6 | **Capture, do not ask** | `model_access` (credits / ChatGPT plan / Claude plan / own key) from the `credits` step; `build_path` (template / scratch) and `template_key` from the `templates` step; classified first message from the composer | Event properties | Free data that answers "how do they run models" and "how do they want to build". |

Optional, if experiments show room for one more tap: **"Have you built AI agents
before?"** (Not yet / prototypes / in production / I write agent code). Relevance, Make,
Relay and Voiceflow ask a skill question; it sets guidance depth.

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
| `consultant` | Consultant or agency | (cross-team list, as founder) |
| `personal` | Not for work: personal projects or school | (personal list) |
| `other` | Something else | (top templates) |

Why: team maps to the catalog better than job title (n8n, Airtable, Beam, Clay), and the
"Not for work" option replaces a separate work/personal question (n8n, Notion, Replit).
"Consultant or agency" is on Lovable, n8n, Make and Claude; agencies build agents for
clients and are a distinct segment. Map the old
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
| Consultant or agency | Same cross-team list as Founder, plus "Build agents for my clients" |
| Personal / school | Research a topic → (gap); Job hunting → `job-hunt-research`; Summarize my email and calendar → (gap); Build a personal assistant → (gap) |

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

- **Still missing exact option lists** (needs bundle analysis or a walkthrough, see
  [How we got data](#how-we-got-data-on-closed-source-products)): Manus (nine role cards),
  Beam (industry, team size, role), Zapier (role, company size), Make (all five fields),
  Relevance AI (size, department, role, skill), Retool (the onboarding question), Tines,
  Clay (team type, CRM), CrewAI AMP. Confirm the clone-based Lovable and Notion lists with
  one fresh signup each. Save screenshots next to this file.
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

Public UI clones and transcriptions ([C]):

- Lovable roles and sizes: `Forgeweb-ai/Forgeweb` `forge-ui/src/pages/onboarding.tsx`,
  `YashjitPal/Willow` `features/onboarding/src/Onboarding.tsx`,
  `digit2ai/RinglyPro-CRM` `v2ai-start.html`, `kenken64/2ndBrain.ceo` `design.md`
- Notion: `Hacault14/limenote` `app/onboarding/page.tsx`, `tarun-hexon/folder-chat`
  `config/constants.js`
- Claude work functions: `siddharthanagula3/agiworkforce`
  `docs/research/leader-settings-and-directory-reference-2026-09-07.md`

Secondhand (teardowns, reviews, tutorials):

- Clay: https://supademo.com/user-flow-examples/clay
- Zapier (Japanese tutorial): https://techmania.jp/blog/zapier/
- Make (Spanish manual): https://imacreste.com/manual-como-usar-make-com/
- Botpress: https://cybernews.com/botpress-ai-review/
- Retool: https://pageflows.com/post/desktop-web/onboarding/retool/
- Tines: https://www.tines.com/university/tines-stories-foundations/core-ui-navigation/sign-into-tines-stories/

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
