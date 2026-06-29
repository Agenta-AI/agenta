# Reddit Launch Research: Agenta 2.0

GTM research for the Agenta 2.0 launch. Agenta 2.0 is an open-source, self-hostable
agent platform. You build your own AI agents and automations by talking to an agent.
No nodes, no JSON, unlike n8n. Other angles: use your own coding subscription (Claude
Code), self-host your own models (Llama, DeepSeek), the agent learns from feedback, and
it is an easy open-source alternative to n8n, Gumloop, and Zapier.

## Method and confidence

The research used live web search plus third-party Reddit trackers (mainly GummySearch,
data dated mid-2026) cross-checked against marketing guides and community sources.

Important caveat: Reddit.com and its mirrors and proxies were blocked from the research
environment, so verbatim sidebar rule text could not be pulled for most subs. Rule
descriptions below come from secondary sources and are marked as paraphrase where they
are not direct quotes. Subscriber counts are approximate snapshots. Several of these subs
grow more than 100 percent per year, so counts likely understate current size. Before
posting, open each sub's `/about/rules` page in a browser and confirm three things: (a)
whether standalone "I built X" posts are allowed or thread-only, (b) the promo-thread or
showcase schedule, and (c) any karma or account-age minimum. No counts or rules were
fabricated.

---

## Ranked shortlist: where to launch first

| Rank | Subreddit | ~Size | Why | Recommended angle |
|---|---|---|---|---|
| 1 | r/selfhosted | ~790K | Best ideological fit; has a FOSS exemption that Agenta clears | Open-source, fully self-hostable, Docker Compose, no telemetry, no cloud lock-in |
| 2 | r/LocalLLaMA | ~760K | Flagship local-AI sub; core "self-host your own models" audience | Runs entirely against your local models (Ollama, llama.cpp, vLLM), no API cost |
| 3 | r/AI_Agents | ~390K | Fastest-growing agent-builder sub; showcase-friendly | Build agents by talking instead of wiring nodes; self-learning; open-source |
| 4 | r/SideProject | ~440K+ | Launch is the purpose of the sub | "I built an open-source agent platform you build by talking" build story |
| 5 | r/n8n | ~245K | Exact freelancer/agency persona; build-and-share is the norm | Complement, not attack: build by describing, self-host, client handoff |
| 6 | r/ClaudeCode | ~290-330K | Audience already lives in a Claude Code subscription | "Wire your Claude Code subscription into a self-hosted agent platform" |
| 7 | r/developersIndia | ~1.6M | Largest emerging-market dev community; cost-motivated | Showcase post: OSS self-hostable n8n alternative, cost + own-models story |
| 8 | r/automation | ~218K | Broad automation crowd; cost-and-control threads recur | Open-source self-hosted alternative to Zapier/Make, cost math, real workflow |
| 9 | r/ClaudeAI | ~965K | Largest Claude community; has "Built with Claude" flair | Outcome-first: built a self-learning agent by talking to Claude |
| 10 | r/opensource | ~360K | Exists to share your own OSS; Promotional flair | OSS alternative to n8n/Zapier, lead with license and repo |
| 11 | r/LocalLLM | ~180K | Friendlier, semi-technical local-models crowd; Project flair | How-to: self-hosted agent on top of your local model |
| 12 | r/indiehackers | ~150-180K | Cost-and-control bootstrapper audience; Self-Promo flair | "Why I built an open-source alternative to n8n/Zapier" |

Do NOT post standalone launches in these (self-promo banned or thread-only): r/LLMDevs,
r/startups, r/Entrepreneur, r/smallbusiness, r/freelance, r/consulting, r/Upwork,
r/Fiverr, r/MachineLearning, r/homelab. Details in the "do not get banned" section.

---

## Cluster 1: AI agents, agentic, LLM tooling

### r/AI_Agents (~390K, very high growth)
1. Approximately 390K members, around 141 percent growth in the past year. Very active.
   One of the fastest-growing AI subs. "Discussion" is the dominant flair.
2. Discussion: building agents from scratch, agent architecture, memory, production and
   reliability, "what tools are you using," and frequent comparisons of no-code platforms
   (n8n, Flowise) and local LLMs (Ollama). Self-describes as a place for discussion around
   the use of AI agents and related tools.
3. Launch culture: showcase-friendly. Builder demos are welcomed when framed as "I built
   X, here is what I learned." Exact karma/age gate and any promo thread could not be
   verified; check in-app. Not a self-promo ban.
4. Fit: strongest overall fit. Resonant angles: build-by-talking versus nodes/JSON,
   self-learning agent, use your own Claude Code subscription, open-source and
   self-hostable.
5. How to launch: post as a builder, not a vendor. Lead with the novel mechanic (talk to
   build), add architecture detail and a demo GIF, put the GitHub link lower down. Engage
   on cost/control and memory threads first.

### r/AgentsOfAI (~100-120K, explosive growth)
1. Roughly 100K to 120K members (sources split, rising fast). High engagement.
2. Discussion: autonomous agents, agent cost versus human labor, job-market impact,
   open-source agent tooling, practical workflows. Has a dedicated "I Made This" flair, so
   showcasing is an explicit sanctioned category.
3. Launch culture: showcase-accepting via the "I Made This" flair. Verbatim self-promo
   rule not retrieved; verify gates in-app. Not a ban.
4. Fit: good. Open-source agent tooling and cost-versus-labor angles land here.
5. How to launch: use the "I Made This" flair. Lead with the novel mechanic (talk to
   build, self-learning) and the open-source self-host control story to differentiate from
   the SaaS agent tools the sub debates.

### r/LLMDevs (~125-156K) — SELF-PROMO BANNED, flag
1. Approximately 125K to 156K members, growing. Developer-heavy. Themes: benchmarks, LLM
   reliability, AI agents. Flairs: Discussion, Resource, Help Wanted, Tools.
2. Discussion: technical LLM development, reliability, agent building.
3. Launch culture: self-promotion is prohibited (two independent secondary sources agree).
   Do not drop a launch post here.
4. Fit: audience fit is excellent, but the channel is closed to promotion.
5. How to launch: value only. Contribute a genuinely useful technical writeup (agent
   reliability, self-hosting open models, how talk-to-build maps to tool-calling) with no
   product pitch. Any link-drop launch will be removed.

### r/LangChain (~87-102K)
1. Approximately 87K to 102K members, rising fast. Technical, practical. Functions like a
   problem-solving forum. Flairs: Discussion, Question/Help, Tutorial, Resources,
   Announcement, News, plus a Self-Promotion flair.
2. Discussion: building agents and RAG, production pain, framework comparisons (CrewAI,
   AutoGen), observability, memory, "which framework."
3. Launch culture: limited self-promo, the informal 90/10 rule applies. A Self-Promotion
   flair exists and "I built X" posts are common. Showcases tolerated if you are an active,
   helpful participant. Not a ban.
4. Fit: strong. These people already build agents and feel framework and JSON pain, so
   "build agents by talking, no nodes/JSON, open-source alternative to n8n" lands.
5. How to launch: answer LangChain questions first to earn standing, then post a technical,
   comparison-driven share with the Self-Promotion or Discussion flair. Keep promo to about
   1 in 10 of your activity.

---

## Cluster 2: Automation (n8n, Zapier, Make alternatives, "automate my work")

### r/n8n (~245K, very high growth) — top automation target
1. Approximately 245K members, around 162 percent growth in a year. Very high activity.
   "Help" is the top flair.
2. Discussion: workflow builds, lead-gen/scraping/outreach workflows, AI agent
   integration, self-hosting n8n (Hetzner, DigitalOcean, Docker), client work, how to hand
   off automations to clients, finding paid n8n work. This is exactly the
   freelancer/agency persona.
3. Launch culture: heavily showcase-driven; "I built X with n8n" is the dominant post
   pattern, so build-and-share is normal. This is a competitor's home turf, so position as
   complement, not attack. Verbatim rules not retrieved.
4. Fit: very strong for the freelancer-builds-for-clients audience. Angles: open-source and
   self-hostable (they already self-host), build by talking instead of dragging nodes/JSON,
   easier alternative. Tread carefully on "alternative to n8n" framing inside n8n's own sub.
5. How to launch: do not bash n8n. Frame as "I love n8n but wanted to build agents by
   describing them instead of wiring nodes, so I built this open-source self-hostable
   thing." Show a concrete client-automation use case, a GIF, before/after time saved, and
   the GitHub link. The client-handoff angle over-indexes here.

### r/automation (~218K, high growth)
1. Approximately 218K members, around 120K added in a year. High activity.
   Platform-agnostic. Flairs: Question, Showcase, Discussion, Help, Project.
2. Discussion: automation tools and implementations, AI automation, "I automated my job,"
   cost management of AI automation, automation-engineer careers. Make/Zapier/n8n dominate
   the tool talk.
3. Launch culture: value-first self-promo allowed. Paraphrased rule: no spam or
   self-promotion without context; lead with value, not your product. Use the Showcase or
   Project flair.
4. Fit: strong and broad. Angles: open-source alternative to Zapier/Make/Gumloop, cost and
   control, self-hosting.
5. How to launch: Showcase or Project flair, before/after with quantified time saved,
   screenshots or a workflow diagram, honest about limitations. Lead with the problem
   solved.

### r/nocode (~131K)
1. Approximately 131K members. Solid activity. Practical and solutions-oriented. Related
   subs: r/NoCodeSaaS (~45K), r/lowcode (~5K).
2. Discussion: building without code, no-code/low-code platforms (Bubble, FlutterFlow,
   Adalo), automation, AI app builders. Flairs: Discussion, Showcase, Question, Tutorial,
   Tool.
3. Launch culture: lenient but authenticity-gated. Paraphrased rule: no spam or excessive
   self-promotion; pure promotional posts get ignored. The community spots fake reviews
   quickly. Not a ban.
4. Fit: good. "Build agents without code/nodes/JSON by talking" is squarely on theme. This
   audience skews less technical, so soften the self-hosting and Claude Code subscription
   angles.
5. How to launch: Showcase or Tutorial flair, a full tool breakdown, real build experience,
   honest limitations, and a short demo. Lead with the no-code-by-conversation hook.

### r/zapier (~18-22K)
1. Approximately 18K to 22K members. Smaller but engaged.
2. Discussion: Zapier troubleshooting and platform comparisons (Make, n8n).
3. Launch culture: moderate self-promo. Paraphrased rule: self-promotion is allowed in
   context; lead with value; promotional posts may be removed; no spam or affiliate links.
4. Fit: moderate. It is small and competitor-branded. Best for the cost/control "open-source
   alternative to Zapier" angle, but the post-volume ceiling is low and mods may remove overt
   alternatives.
5. How to launch: only post if you genuinely solve a Zapier pain (cost, limits, lock-in).
   Lead with a workflow people cannot easily do or afford in Zapier; mention Agenta as the
   how, not the headline.

---

## Cluster 3: Self-hosting, homelab, open-source software

### r/selfhosted (~790K, very high) — best overall fit
1. Approximately 790K members, around 44 percent growth in a year. High activity, many
   posts per day. "Need Help" is the top flair. Note: older guides cite 350K, which is
   stale.
2. Discussion: self-hosted alternatives to SaaS, Docker and Compose, Proxmox, media tools,
   VPS choices (Hetzner, netcup), privacy and data control. Posts that do well: a genuinely
   self-hostable open-source tool with screenshots, a GitHub link, and a Docker Compose.
3. Launch culture: self-promo is gated by a 10 percent rule, but there is a FOSS exemption
   that Agenta qualifies for. Quoted (secondary source): "if your post is about a project
   that is completely open source and can be self-hosted in full without payment, and your
   account is at least 7 days old, your post is exempt from this rule as long as you continue
   to engage in comments." Also: posts must clearly relate to self-hosting. Gate to clear:
   account at least 7 days old plus you must stay and answer comments. The rumored weekly
   self-promo megathread did not verify; the FOSS exemption is the real mechanism.
4. Fit: extremely strong. Self-hostable plus fully open-source plus Docker is exactly what
   they reward. Cost-and-control is native. Build-by-talking and "open-source alternative to
   n8n/Zapier" both land.
5. How to launch: title it like a project share, not an ad. Lead with the self-host story:
   Docker Compose, no telemetry, GitHub link up top. Be explicit it is free and fully
   self-hostable. Then live in the comments for 24 to 48 hours. Avoid any cloud or SaaS
   framing and avoid marketing language; this crowd punishes it and rewards replicability.

### r/homelab (~1.0M) — promo-strict, flag
1. Approximately 1.0M members (one guide says 1.2M). Project-showcase heavy.
2. Discussion: hardware, virtualization (Proxmox, ESXi, Unraid), networking, NAS, rack
   builds. It is about the infrastructure, less about the apps running on it.
3. Launch culture: restrictive. Paraphrased: strict self-promo policy; Rule 4 is roughly
   "no selling or buying in main posts." Hostile to anything that reads as a product launch.
4. Fit: weaker than r/selfhosted. Agenta is software, not hardware, so a direct launch is
   off-norm.
5. How to launch: do not do a launch post. Participate organically and mention Agenta only
   in answer to "what are you running" or "local AI on my homelab" threads. Spend the reach
   budget on r/selfhosted instead.

### r/opensource (~360K) — promo-friendly with flair
1. Approximately 360K members, around 32 percent growth. Older "210K" figures are stale.
2. Discussion: open-source projects, "looking for an open-source alternative to X," AI
   projects, licensing. The Promotional flair is the single most-used flair, so this
   community partly exists to share your own OSS.
3. Launch culture: limited self-promotion allowed; use the Promotional flair. Must be
   genuinely open source. Not a ban.
4. Fit: strong on the "open-source alternative to n8n/Gumloop/Zapier" angle and OSS
   credibility. Weaker on the local-LLM angle. Developer-skewed audience.
5. How to launch: use the Promotional flair, lead with the license and repo, frame as
   "open-source alternative to n8n/Zapier, build agents by talking, self-hostable." Be ready
   for licensing and architecture questions.

### Secondary self-hosting subs
- r/HomeServer (~289K): overlaps r/selfhosted, smaller, similar FOSS-friendly norm. Decent
  secondary target for self-host plus local-models. Self-promo rule unverified.
- r/degoogle (~502K): privacy and anti-Big-Tech. Indirect fit only. The angle is data
  ownership and not sending prompts to OpenAI, plus self-hosting your own models. Privacy
  subs tend to be promo-strict, so tread carefully and lead with privacy.
- r/DataHoarder (~976K): storage and preservation focus. Poor fit. Skip.

---

## Cluster 4: Local LLMs, running your own models

### r/LocalLLaMA (~760K, fast growth) — flagship local-AI sub
1. Approximately 760K members, around 54 percent growth in a year. High volume, dozens of
   posts per day. Flairs: Discussion, Resources, News, New Model, Tutorial. Old "65K"
   figures are badly stale.
2. Discussion: local model releases (Qwen, Mistral, Llama, DeepSeek, Gemma, GLM), GPU and
   hardware, quantization (GGUF), inference engines (llama.cpp, Ollama, vLLM), benchmarks,
   coding-model comparisons. Technically sharp, skeptical of hype, allergic to closed/cloud
   shilling, but receptive to open-source tools that help run local models.
3. Launch culture: not a ban, but anti-cloud-funnel. The general 10 percent self-promo norm
   applies; substantive participation is expected before posting. Salesy or low-effort posts
   get downvoted and removed fast. Rules could not be verified verbatim; read the live
   sidebar.
4. Fit: best in cluster for the local-models story. Angles: self-host your own models
   (Llama/DeepSeek/Qwen), use your own compute, no API cost, fully open-source, runs against
   Ollama or local endpoints. Build-by-talking and self-learning are differentiators if
   framed technically. Anti-lock-in sentiment is a tailwind.
5. How to launch: lead with local-model substance, not "agent platform." Example: "open-source
   agent platform that runs entirely against your local models (Ollama, llama.cpp, vLLM), no
   cloud, no API keys, you build agents by talking to one." Show it working with a named local
   model and real hardware. Provide the repo and self-host instructions. Expect hard technical
   questions and answer them. No generic startup blurb.

### r/LocalLLM (~180K, fastest growth in set)
1. Approximately 180K members, around 146 percent growth in a year.
2. Discussion: "how do I run X locally," hardware requirements, model recommendations
   (Qwen, Gemma, Ollama). More help and solution-seeking than r/LocalLLaMA. Flairs:
   Question (most common), Discussion, Project, plus a Self-Promotion category.
3. Launch culture: Project and Self-Promotion posts are accepted; there is a dedicated
   Project flair. The bar appears lower and friendlier than r/LocalLLaMA. Not a ban.
4. Fit: strong and more forgiving for a first launch. The audience is closer to
   "semi-technical, cost-and-control motivated." Same local-models, self-host, own-compute
   angles.
5. How to launch: use the Project flair. Frame for the practical user: "run agents against
   your local model, fully self-hosted, free." A how-to ("I set up a self-hosted agent on
   top of Ollama, here is how") beats a pure announcement.

### r/ollama (~126K)
1. Approximately 126K members, around 72 percent growth.
2. Discussion: running and optimizing Ollama, local implementations, model comparisons,
   integrations, "cloud alternative" framing. Privacy-motivated.
3. Launch culture: integration-hungry; people constantly share tools built on Ollama, so a
   tool that natively targets Ollama is on-topic rather than spam. Confirm the sidebar before
   a hard launch. No verified ban.
4. Fit: very strong if Agenta has a concrete Ollama integration story.
5. How to launch: make it Ollama-specific in the title and the demo. Lead with the
   integration, not the platform. Show a real agent running on a local Ollama model.

### r/OpenSourceAI (~24K, explosive growth)
1. Approximately 24K members, around 500 percent growth in a year. Small but high
   signal-to-noise.
2. Discussion: open-source models, AI agents, local ML, code projects and tooling.
   Builder-friendly.
3. Launch culture: self-promotion of open-source projects appears welcomed. Low removal
   risk for a genuine OSS launch.
4. Fit: direct thematic match. Smaller reach but every reader self-selected for open source.
5. How to launch: straightforward show-and-tell. Emphasize the license, repo, self-hosting,
   and the differentiators (build by talking, bring your own coding subscription). Good place
   to test messaging before r/LocalLLaMA.

### Niche local-LLM subs (low priority)
- r/Oobabooga (~17K): text-generation-webui troubleshooting. Relevant only with an
  integration. Too small to prioritize.
- r/KoboldAI (~24K): KoboldCpp and story generation. Creative-writing lean, poor fit. Skip.

---

## Cluster 5: Indie hackers, bootstrappers, SaaS, side projects

### r/SideProject (~440K+, sources conflict) — best launch-welcome sub
1. Approximately 440K to 760K members (trackers conflict, range it). Among the most active
   launch subs.
2. Discussion: "I built X" project shares, work-in-progress, feedback, tech-stack talk.
   Build-story posts win; bare links die.
3. Launch culture: self-promo and launches are the purpose of the sub. A link with no
   context is treated as spam. Reposting the same project quickly is spam. Post-and-ghost
   (not replying) can get removed. Flair is used. Karma/age gate unconfirmed.
4. Fit: excellent. "Build an agent by talking, open-source, self-host" is exactly the
   maker-tool content rewarded here.
5. How to launch: title as a build story ("I built an open-source agent platform where you
   build agents by talking, no nodes/JSON"). Include what, why, and stack, a demo GIF, and
   one clear feedback question. Reply to every comment.

### r/indiehackers (~150-180K)
1. Approximately 150K to 180K members. Note: r/indiehackers equals r/IndieHackers (same
   sub). A separate r/Indiehacker singular is around 1K and dead; skip it.
2. Discussion: founder journeys, MRR milestones, AI coding tools, launches, feedback.
3. Launch culture: allowed. Has a Self-Promotion flair and a recurring Friday "share your
   project" thread. Supportive culture; the 90/10 norm applies.
4. Fit: strong. Bootstrapped, cost-and-control audience matches "use your own Claude
   subscription, self-host models."
5. How to launch: lead with the why ("Why I built an open-source alternative to n8n/Zapier").
   Use the Self-Promotion flair or the Friday thread. Emphasize cost and control for solo
   builders.

### r/SaaS (~736K) — strong but rate-limited
1. Approximately 736K members, fast-growing, very active.
2. Discussion: building and selling SaaS, MRR milestones, pricing, churn, tooling. Milestone
   plus lessons posts do best.
3. Launch culture: tolerant but rate-limited to roughly one self-promo per 60 days (counts
   posts, comment plugs, links, and mentions, per a secondary source; verify). Affiliate and
   reseller promo removed. "Share Your SaaS" threads exist.
4. Fit: strong, but spend your one allowed post wisely.
5. How to launch: frame as a lesson ("We went open-source and self-hostable to kill our LLM
   bill, here is what happened"), include a metric or decision, soft-mention Agenta. Do not
   burn the allowance on a bare launch.

### r/microsaas (~200K)
1. Approximately 200K members, moderate-high activity.
2. Discussion: small and solo products, niche markets, small wins ($500 to $5K MRR),
   solo-founder challenges.
3. Launch culture: self-promo allowed with value framing; milestones welcomed. Common
   practical floor cited (around 30-day account, around 100 comment karma). Specific rules
   unverified.
4. Fit: good. Freelancers and consultants building client automations map to micro-SaaS
   readers.
5. How to launch: angle at solo economics ("self-host your own models, use your existing
   Claude subscription, no per-seat bill"). Honest small wins resonate.

### r/EntrepreneurRideAlong (~688K-1.1M, uncertain)
1. Approximately 688K to 1.1M members (sources conflict; flag uncertain). High activity.
2. Discussion: real-time founder journeys, raw building and scaling, anti-guru ethos.
3. Launch culture: more permissive than r/Entrepreneur; promo accepted as journey or
   progress, not as an ad. Read the sidebar; bans reported for rule breaks.
4. Fit: good for narrative posts about building Agenta or building client automations with
   it.
5. How to launch: ongoing-journey tone ("Building an open-source agent platform in public,
   month X"). Less polished, more honest.

### r/buildinpublic (~50-103K)
1. Approximately 50K to 103K members (range it; high growth).
2. Discussion: build-in-public progress, MVPs, metrics, AI tools, wins and failures.
3. Launch culture: encourages progress and metrics sharing; self-promo is core. Gates
   unverified.
4. Fit: good. Self-learning agent and build-by-talking make natural progress content.
5. How to launch: post incremental updates with real numbers and screenshots, not a one-shot
   launch.

### Niche feedback/recruiting subs
- r/roastmystartup (~32K): brutally honest critiques; self-promo is required (you invite the
  roast). Good for landing-page and positioning feedback, not mass acquisition.
- r/alphaandbetausers (~38K): post your product freely to recruit testers. Good for early
  self-host and cloud testers, not a launch splash.

### Self-promo BANNED or thread-only (flag, do not standalone-launch)
- r/startups (~1.8M): standalone "I built X" posts are removed. Self-promo only in the weekly
  "Share Your Startup" megathread; Feedback Friday requires giving feedback first. Strict.
- r/Entrepreneur (~5M): strict no-self-promo; AutoModerator reportedly blocks common SaaS
  domains. Weekly thread only. Put your domain in your bio, do not post the product.
- r/smallbusiness (~2.47M): business-promotion posts only in designated weekly threads. Also
  bans market research and app-validation and blog links.
- r/GrowthHacking (~200K): tactics-focused, direct promo discouraged. Possible later for a
  "how we grew" tactics writeup only.

---

## Cluster 6: Freelancing, consulting, Upwork, Fiverr

Honest finding: the literal freelance-platform subs (r/freelance, r/consulting, r/Upwork,
r/Fiverr) ban or reject tool and self-promotion. Right audience, wrong launch venue. The
real launch targets for the freelancer-who-automates persona are the automation and
agent subs (r/n8n, r/automation, r/AI_Agents) above. Two business-angle subs are worth
using:

### r/agency (~94K) — right buyers, business angle
1. Approximately 94K members, around 74 percent growth.
2. Discussion: agency owners and freelancers in digital marketing; client acquisition,
   pricing, software costs, AI's impact on agencies, pricing AI-workflow access.
3. Launch culture: service self-promo happens, but verify the product-promo rule before
   pitching. Not a free-for-all.
4. Fit: good. This is freelancers and consultants who build automations for clients, worried
   about AI cost and margin (suits self-host, own subscription, cost control).
5. How to launch: business angle, not tech. Example: "How are you pricing AI automation for
   clients without per-seat SaaS eating margins? We self-host an open-source agent platform,
   here is the cost math."

### r/SideHustle (~3.3M) — medium, income angle
1. Approximately 3.3M members, highly active.
2. Discussion: extra income, "what side hustle should I start," success stories. Money-first,
   less technical.
3. Launch culture: tolerates some self-promo with limits (a Self-Promotion category exists);
   not a hard ban.
4. Fit: medium and indirect. "Build AI automations for clients as a side hustle" works, but
   the crowd is less technical.
5. How to launch: outcome and income framing ("Started offering AI automation to local
   businesses, here is the open-source self-hosted stack I use so it stays profitable").

### Self-promo BANNED (flag, listen and help only)
- r/freelance (~682K): paraphrased rule: no advertising or self-promotion, including apps,
  SaaS, portfolios, newsletters; no surveys or market research; no referral or shortened
  links. Strictly moderated, permabans.
- r/consulting (~370K): paraphrased rule: no spam, offers, surveys, or AI slop. Skews
  big-firm consultants, not indie builders. Skip.
- r/Upwork (~185K): platform-gripe sub; gig and tool promo removed. The resonant theme is
  owning your own tooling and not depending on a platform, which rhymes with self-hosting,
  but it is not a launch venue.
- r/Fiverr (~77K): gig-marketplace help and vent; tool promo removed. Low fit.
- Low fit / skip: r/digitalnomad (travel/lifestyle), r/freelanceWriters (content niche),
  r/forhire (job board for offering services).

---

## Cluster 7: Claude, Claude Code, AI coding tools

The "use your own Claude Code subscription" angle is native here. Ranked:
r/ClaudeCode > r/ClaudeAI > r/ChatGPTCoding > r/cursor.

### r/ClaudeCode (~290-330K) — top fit in cluster
1. Approximately 290K to 332K members (sources split, growing fast). High activity.
2. Discussion: Claude Code performance and complaints about slowdowns or quality
   regressions, agent workflows, CLAUDE.md setups, MCP servers, methodology, project
   showcases. A Showcase flair is actively used.
3. Launch culture (inferred, verify): framed as "build, share, and solve together."
   Showcase posts are normal; "I built X" is allowed as a project share. No promo-day or
   hard karma gate confirmed. Not a ban. Confirm whether showcases must use the Showcase
   flair.
4. Fit: strongest in cluster. Audience already pays for and lives inside a Claude Code
   subscription, so "power self-hosted agents with your own Claude subscription" is native.
   Cost-control resonates with the recurring "Claude Code got slower, I am burning tokens"
   threads.
5. How to launch: builder showcase, not an ad. Angle: "I wired my Claude Code subscription
   into a self-hosted agent platform; I build agents by talking to Claude instead of dragging
   n8n nodes." Short clip or screenshots, open-source mention, link in a comment, Showcase
   flair.

### r/ClaudeAI (~965K) — biggest reach in cluster
1. Approximately 965K members (a May-2026 source cited ~747K; the gap reflects fast growth).
   Very high activity, largest in cluster.
2. Discussion: solution and advice requests, real-world use cases, Claude and Claude Code
   tips, model behavior, humor. Mixed devs, power users, and semi-technical readers.
3. Launch culture (inferred, verify): dedicated flairs reported, "Built with Claude" and
   "Claude Code Workflow," a strong signal that show-and-tell is accommodated via flair.
   Most promo-tolerant of the big Claude subs, but high volume sinks generic posts.
4. Fit: high reach, good fit. Build-by-talking and own-subscription both land. Broader and
   less hardcore-dev than r/ClaudeCode, so frame for a semi-technical reader too.
5. How to launch: use the "Built with Claude" or "Claude Code Workflow" flair. Outcome-first
   story ("I built a self-learning lead-gen agent by talking to Claude, no nodes, runs on my
   own server, uses my Claude subscription"), demo media, open-source as a trust signal, link
   in comments.

### r/ChatGPTCoding (~385K) — comparison/alternative framing, flag
1. Approximately 385K members, around 34 percent growth. High activity. (A stale source says
   94K; ignore it.)
2. Discussion: despite the name, a general AI-coding-tools sub. Heavy tool comparison
   (ChatGPT vs Claude vs Cursor vs Qwen/Ollama), agentic workflows, IDEs, and a lot of
   self-promotion.
3. Launch culture (flag, verify): self-promotion is a top theme and there is a dedicated
   "Self Promotion Thread." Pure promo is likely funneled into the megathread, while genuinely
   useful "look what I built" discussion can stand alone. Confirm the sidebar before a
   standalone launch.
4. Fit: good. "Open-source self-hostable alternative to n8n/Gumloop/Zapier" and tool-teardown
   framing is what this sub rewards; the multi-tool audience likes the local-models angle.
5. How to launch: a comparison or teardown post performs best ("Tired of n8n's JSON/nodes, so
   I built agents by talking, here is how it compares"). If rules require, drop the link in the
   Self Promotion Thread and keep any standalone post genuinely educational.

### r/cursor (~143K) — adjacent, highest risk, flag
1. Approximately 143K members, around 92 percent growth. High activity, emotionally charged.
2. Discussion: Cursor usage but dominated by frustration over billing and token spend,
   quality complaints, "Venting" and "Bug Report" flairs, "what should I switch to."
3. Launch culture (flag, verify): self-promo tolerance uncertain and likely stricter
   (single-vendor community). Do not assume competitor "I built an alternative" posts are
   welcome; they may be removed.
4. Fit: adjacent. Cost and lock-in pain is acute and on-message, but it is a single-product
   community that may resent competitor pitches.
5. How to launch: lead with the pain, not the product. Participate in cost and lock-in
   threads; mention open-source self-hosting as one option. Lowest-risk as a comment play.

Honorable mentions: r/Anthropic (~170K, pricing complaints and company news, poor launch
fit); r/AICodingAssistants could not be verified active, likely tiny or dormant,
deprioritize.

---

## Cluster 8: Open-source AI and ML communities

### r/MachineLearning (~3.1M) — credibility venue, NOT a launch venue, flag
1. Approximately 3.1M members, slow growth. High volume, research-skewed.
2. Discussion: research papers, methods, datasets. Practitioner and researcher audience.
3. Launch culture (documented and strict): direct self-promotion is confined to a periodic
   "[D] Self-Promotion Thread"; outside it, promotional posts are discouraged or removed.
   Strict flair enforcement, [R] research, [D] discussion, [P] project/demo, [N] news; mods
   retag non-conforming posts. Basic how-to and futurism and job questions are off-topic.
   Rule 1 is "Be nice."
4. Fit: audience overlaps but the venue is wrong for a launch. A standalone "I built Agenta"
   post will be removed unless it is a substantive [P] technical writeup, or goes in the
   self-promo thread (low visibility).
5. How to launch: no marketing post. Either a substantive [P] with real depth (architecture
   of the self-learning agent, how build-by-talking works, benchmarks) and zero sales tone,
   or the weekly self-promo thread. Treat as credibility-building, not signups.

(See also r/LocalLLaMA, r/OpenSourceAI, and r/LangChain in earlier clusters, which are the
better OSS-AI launch targets.)

Also-rans (lower priority): r/learnmachinelearning (~655K, beginners and career, weak fit,
only for an educational tutorial); r/huggingface (~24K, niche secondary if framed around
running HF models locally); r/artificial (~1.3M, broad and low-intent, weak fit).

---

## Cluster 9: Regional and emerging-market tech subs

Honest top-line: India and Brazil carry this cluster. Indonesia is genuinely weak on
Reddit (devs are on Discord and Facebook; no dev sub of any size exists). China, Japan,
and Korea are not viable on Reddit (those markets use WeChat/Juejin/V2EX, Zenn/Qiita,
Naver). Use the targeted subs below, not r/india, where tech posts get buried.

### r/developersIndia (~1.6M) — strongest in cluster
1. Approximately 1.6M members, around 13 percent growth (roughly 4x since late 2023). Very
   active, dozens of posts per day.
2. Discussion: heavily career-weighted (jobs, resumes, salary, layoffs) but a real
   engineering community; side projects, open-source, "I built X," AI/LLM tooling, and
   self-hosting threads do well when technically substantive.
3. Launch culture (wiki-documented): runs structured threads including "Showcase Sundays" for
   sharing your own work. Moderator-heavy and anti-spam; a raw "check out my product" outside
   the showcase context tends to get removed. Not an outright ban; it channels promo. Verify
   showcase cadence and karma/age gate.
4. Fit: very high. India is the heaviest emerging-market dev population on Reddit and the
   audience is cost-and-control motivated. The n8n/Zapier-alternative framing resonates.
5. How to launch: English. Post into the showcase thread or write a genuine technical piece:
   "Open-source self-hostable alternative to n8n where you build agents by talking, here is the
   architecture and why self-hosting plus your own models (Llama/DeepSeek) cuts cost." Lead
   with engineering and the cost story; downplay marketing tone.

### r/indianstartups (~118K) — best for the founder angle
1. Approximately 118K members, around 67 percent growth. (A 2023 figure of ~8.5K is stale.)
   Founder-dense, active.
2. Discussion: startups, founders, AI (top-5 topic), marketing, fundraising, finding
   technical co-founders, payment stacks, revenue and growth.
3. Launch culture (inferred, verify): self-promotion is a primary post type; tolerates
   founders talking about what they build more than a pure-engineering sub. Not a ban.
4. Fit: very high for the founder framing (cost-conscious bootstrappers building with AI).
   Less deep-technical, so lead with the business and cost case.
5. How to launch: English. Angle: "Bootstrapped founders, open-source agent platform so you
   do not pay Zapier/Gumloop per-task fees; self-host it, use your own Claude subscription,
   run your own models." Build-in-public beats a launch announcement.

### r/brdev (~307K) — strongest in Brazil
1. Approximately 307K members, around 19 percent growth (was ~126K in late 2023). Active. An
   earlier scrape hinted "quarantined"; this could not be confirmed and is likely false, but
   do a quick manual check.
2. Discussion: all subjects related to IT and programming. Top flair is Carreira (career),
   but real programming and tooling discussion is welcome.
3. Launch culture (inferred, verify): Brazilian dev subs typically restrict job posts and
   self-promo to weekly threads. brdev's verbatim self-promo rule could not be retrieved;
   verify whether standalone launch posts are allowed or thread-only. Not an outright ban, but
   career-forum-flavored.
4. Fit: high. Brazil is a major cost-conscious market with FX sensitivity to US SaaS;
   self-hosting, open-source, and own-your-models map to local budget realities.
5. How to launch: Portuguese (PT-BR), not English; this matters. Angle: open-source,
   auto-hospedavel, alternativa ao n8n/Zapier, use seu proprio modelo (Llama/DeepSeek) para
   cortar custos. Write as a genuine "fiz isso e foi o que aprendi" technical share.

### r/programacao (~141K) — Brazil secondary, more junior
1. Approximately 141K members, around 18 percent growth (was ~82K in 2023). Active.
2. Discussion: programming, college and study, courses, Python; skews more student and
   junior than brdev. Has a Projetos (Projects) flair; humor is the top flair (lighter sub).
3. Launch culture (inferred, verify): project sharing is allowed via the Projetos flair.
   Verbatim self-promo rules not retrieved. Not a ban.
4. Fit: moderate. Good reach but more junior and learning-oriented, fewer ready self-hosters.
   Good for awareness and feedback, weaker for conversion than brdev.
5. How to launch: Portuguese (PT-BR), Projetos flair. Frame as an open-source project to learn
   from or contribute to. Educational and build-in-public fits the student crowd.

Not recommended: Indonesia (no viable dev sub on Reddit, pursue via Discord/Facebook
separately); China/Japan/Korea (use local platforms, not Reddit); r/india and
r/IndianStreetBets (wrong venue or off-topic).

---

## How to not get banned: Reddit self-promo etiquette

- Respect the 90/10 rule. Across almost every sub, no more than about 10 percent of your
  posts and comments should be self-promotional. Build comment history first so the launch
  is not your account's only activity.
- Account hygiene. Several subs cite a practical floor of roughly a 30-day-old account and
  around 100 comment karma, and many auto-filter brand-new accounts. r/selfhosted's FOSS
  exemption explicitly requires the account to be at least 7 days old.
- Use the right flair. Showcase, Project, Self-Promotion, Promotional, and "I Made This"
  flairs exist precisely so makers can share. Using them keeps you within the rules.
- Lead with value, not the product. A build story, a comparison, a workflow, or a how-to
  performs far better and survives moderation. Put the link in a comment or lower in the
  post.
- Do not post-and-ghost. Subs like r/SideProject and r/selfhosted remove or punish posters
  who do not answer comments. Plan to stay in the thread for 24 to 48 hours.
- Never cross-post identical text across subs in a short window. Anti-spam filters catch it
  and mods notice. Rewrite per sub and space launches out.
- Do not attack competitors on their own turf. In r/n8n, r/zapier, and r/cursor, frame as a
  complement or "here is another approach," not "your tool is bad."
- Subs to never standalone-launch in (self-promo banned or thread-only): r/LLMDevs,
  r/startups, r/Entrepreneur, r/smallbusiness, r/freelance, r/consulting, r/Upwork,
  r/Fiverr, r/MachineLearning, r/homelab. Use their weekly threads or pure value-only
  contributions instead.
- Verify before you post. Open each sub's `/about/rules` page in a browser and confirm the
  standalone-vs-thread rule, the promo or showcase schedule, and any karma/account-age gate.
  The rule text in this report is largely paraphrased from secondary sources because Reddit
  was not directly reachable during research.
