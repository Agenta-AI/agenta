# Channels in SaaS agent platforms: Lindy, Dust, Relevance AI

This is a first-pass (breadth over depth) competitive study of how three SaaS agent platforms connect agents to messaging surfaces. "Channels" here means: a user talks to an agent from Slack, Microsoft Teams, email, WhatsApp, or a chat widget; the conversation lives in a session the platform tracks; ideally the same session can continue on another surface, and human approvals of agent actions can flow through the channel.

The three vendors studied are the closest analogs to what Agenta wants to build: a platform where you build an agent, then deploy it to channels.

- **Lindy** (lindy.ai): a no-code agent builder aimed at business users. Agents ("Lindies") are workflows that start from a trigger and run through steps.
- **Dust** (dust.tt): a workspace assistant platform. Teams build many named agents over company knowledge and talk to them, mainly in Slack and Teams.
- **Relevance AI** (relevanceai.com): an "AI workforce" platform. Agents run tasks, can be organized into multi-agent workforces, and are reachable through triggers and an embeddable chat.

All claims cite the page they came from. Claims I could not confirm from a primary source are marked **[unverified]**.

---

## 1. Lindy (lindy.ai)

### Positioning: channels are triggers on a workflow, not first-class conversational surfaces

Lindy's core model is trigger → workflow. A channel message is one kind of trigger among many: "Slack Message Received", a new email in Gmail, a new WhatsApp message, and so on (https://docs.lindy.ai/skills/popular-integrations/slack, https://www.lindy.ai/integrations/whatsapp). The agent's conversational behavior in the channel is something you assemble (a trigger, filters, a response prompt, a "Thread Reply" option) rather than something the platform gives you as a finished "deploy to Slack" surface. Marketing pages do sell the outcome ("build a Slack bot in 10 minutes", https://www.lindy.ai/blog/create-slack-bot), but the mechanics underneath are workflow plumbing.

### Channels supported

Lindy has the widest channel surface of the three:

- **Slack** (https://docs.lindy.ai/skills/popular-integrations/slack)
- **Email** (Gmail/Outlook triggers and actions; email is arguably Lindy's strongest channel given its email-assistant heritage) (https://www.lindy.ai/academy-lessons/ai-agents)
- **WhatsApp / WhatsApp Business** (https://www.lindy.ai/integrations/whatsapp, https://www.lindy.ai/integrations/whatsapp-business). The docs page at docs.lindy.ai/skills/popular-integrations/whatsapp returned 404 at fetch time, so the setup details below the marketing level are **[unverified]**.
- **SMS** via integrations such as SMSTools and SMS Alert (https://www.lindy.ai/integrations/smstools, https://www.lindy.ai/integrations/sms-alert-). These look like third-party connector integrations rather than a native phone-number product.
- **Messenger** is claimed in marketing copy ("multi-channel support: Slack, Messenger, WhatsApp") **[unverified depth]**.
- **"Chat with this Lindy"**: a hosted chat link / embeddable chat for any agent (https://www.lindy.ai/integrations/chat-with-this-lindy).

### Connection UX (Slack)

You add a "Slack Message Received" trigger to an agent, click Connect, and go through a Slack OAuth flow that authorizes the Lindy Slack app for the workspace (https://docs.lindy.ai/skills/popular-integrations/slack, Slack Marketplace listing: https://slack.com/marketplace/A01AZ8UNTCG-lindy). Trigger filters then scope where the agent listens: specific channels, all channels, or direct messages; plus keyword filters ("Hey Lindy", "@bot") and user filters (exclude bots or specific people).

Whether each Lindy agent appears as its own named Slack bot, or all Lindies share one "Lindy" bot identity, is not documented on the pages I read. The Slack Marketplace listing is a single "Lindy" app, which suggests one bot identity per workspace with routing to different agents via trigger filters (channel + keyword). **[unverified]** Community threads show people troubleshooting exactly this kind of routing (https://community.lindy.ai/x/bug-reports/1mk2fjxycpww/troubleshooting-slack-integration-issues-with-agen). This matters for the "two agents in one workspace under different names" question: Lindy appears to answer it with filters, not with distinct bot identities. **[unverified]**

### Conversation model

- **Threads**: the Slack trigger has a "Thread Reply" option, "enable to keep conversations organized within message threads" (https://docs.lindy.ai/skills/popular-integrations/slack). The docs reference thread history in testing steps but do not spell out the mention-to-session mapping or how long a thread keeps mapping to the same agent task.
- **Sessions**: every trigger firing creates a "task" in Lindy's task view (the in-app history of workflow executions). The task view is where a human can see the run and intervene (https://docs.lindy.ai/testing/human-in-the-loop). Whether a human can type replies into the task view and have them land back in the Slack thread (true cross-surface continuation) is not documented on the pages I read. **[unverified]**
- **Email threading**: Lindy's email use cases (drafting replies in an inbox) imply thread continuity, and the Gmail draft flow (below) writes into the real email thread. Depth of multi-email session continuity is **[unverified]**.

### Multi-user

Not documented. The Slack docs mention testing "concurrent requests from multiple users" but say nothing about identity mapping (Slack user to Lindy user), per-user permissions in the channel, or who may steer a running task. This is a documentation gap across the board for Lindy.

### Approvals / human-in-the-loop (Lindy's distinctive feature)

Lindy has an explicit **"Ask for Confirmation"** toggle on any action that has side effects (writing or updating data in another app) (https://docs.lindy.ai/testing/human-in-the-loop). The UX:

1. The agent executes the workflow up to the guarded action, then pauses. The action appears as a **draft** in the task view.
2. The owner gets an **email** asking them to approve.
3. Approval happens via the email link or directly in the task view ("task menu"). Clicking the action button (for example "Send email") resumes the workflow.

Notably, approval does **not** flow through Slack or the originating channel; it flows through email plus the Lindy web app. If you want channel-based review you assemble it yourself: for Gmail there is a draft mode (the agent writes to your real drafts folder and you edit/send in Gmail), and community threads show people hand-building Slack review loops with conditions and Slack messages (https://community.lindy.ai/x/support/gi8qgpumjpk4/creating-a-slack-workflow-for-email-review-and-app). Timeout behavior for pending approvals is not documented.

### Context the agent receives

The trigger delivers the triggering message; a "Response Prompt" tells the agent how to answer; knowledge-base attachments provide grounding. Thread history is referenced but the windowing (how much thread, whether speaker identities are included) is not specified. **[unverified]**

### Limitations and packaging

- Pricing is credit/task-based (each workflow step run consumes credits), so a chatty channel agent has a direct per-message cost. **[unverified detail; pricing page not fetched in this pass]**
- Setup guidance and depth vary a lot by channel; the docs are thin on session semantics everywhere.
- No documented RBAC story for who in a Slack workspace may invoke an agent.

---

## 2. Dust (dust.tt)

### Positioning: the channel IS the product surface

Dust is the purest expression of the feature under study. Its pitch is team agents that live where the team talks: you build named agents in the Dust web app, then the whole company @mentions them in Slack or Teams. Channels are full conversational surfaces, not triggers (https://docs.dust.tt/docs/slack, https://dust.tt/blog/slack-ai-agents).

### Channels supported

- **Slack**: the flagship channel (https://docs.dust.tt/docs/slack).
- **Microsoft Teams**: full parity ambition; public and private team channels plus DMs with the bot (https://docs.dust.tt/docs/dust-in-teams).
- **Email**: every agent is reachable at `agent-name@dust.tt` once the admin opt-in is enabled (https://docs.dust.tt/docs/email-agents).
- Web app conversations, browser extension, and API round out the surfaces (https://docs.dust.tt/docs/automations).

### Connection UX

- **Slack**: an admin enables the integration in Workspace Settings → Integrations, picks the Slack workspace, and approves OAuth permissions. The bot must then be added to each channel (via "Add app" or by mentioning @Dust) (https://docs.dust.tt/docs/slack). Only Slack Owners/Admins can complete the install; only channel members can invite the bot to a channel (https://docs.dust.tt/docs/slack-troubleshooting).
- **One bot, many agents**: there is a single **@dust** bot per workspace ("one interactive bot per Dust workspace maximum", https://docs.dust.tt/docs/slack-troubleshooting). Individual agents are reached *through* it in two ways:
  1. **Inline routing syntax**: `@dust ~agentname` or `@dust +agentname` invokes a specific agent (https://docs.dust.tt/docs/slack).
  2. **Channel linking**: in an agent's settings you link it to specific channels; a bare @dust in that channel then routes to the linked agent instead of the default (https://docs.dust.tt/docs/slack). Private channels cannot have default agents assigned (https://docs.dust.tt/docs/slack-troubleshooting).
  So two agents can coexist in one Slack workspace, but not under two different bot names; they share the @dust identity and are disambiguated by syntax or channel. Multiple agents can participate sequentially in the same thread (documented for Teams, https://docs.dust.tt/docs/dust-in-teams).
- **Teams**: two-sided install: enable the "Microsoft Teams Bot" in Dust settings, then upload a .zip app package through the Teams admin center (https://docs.dust.tt/docs/dust-in-teams). Heavier than Slack, and gated on org policy for custom apps.
- **Email**: admin toggles "Email Agents" in Workspace Settings → Capabilities; after that any workspace member can email, cc, or forward to `agent-name@dust.tt`. Sender identity is verified with DKIM/SPF; mail from non-members is silently dropped (https://docs.dust.tt/docs/email-agents).

### Conversation model

- **Mention-to-session**: a mention in a Slack thread opens an agent conversation scoped to that thread. The agent receives "the full context of the conversation automatically", but only "the thread it's mentioned in, not the entire channel history" (https://docs.dust.tt/docs/slack, https://docs.dust.tt/docs/slack-troubleshooting). Messages that predate the bot's invitation to the channel are inaccessible (Slack platform limitation).
- **Slack DMs are deliberately unsupported**: "@Dust works in public and private channels only. It does not respond in direct messages." Dust frames this as intentional; channels give shared context (https://docs.dust.tt/docs/slack-troubleshooting). Teams, by contrast, does support DMs with the bot (https://docs.dust.tt/docs/dust-in-teams).
- **Cross-surface continuity**: I found no documented way to continue a Slack thread session inside the Dust web app or vice versa. The docs are explicit that Dust does **not** sync the agent's own Slack answers back as data ("we do not synchronize messages written by Dust agents"), which is about data-source hygiene rather than session continuity, but the absence of any "continue in web" affordance in the docs suggests sessions are surface-local. **[unverified — absence of evidence]**
- **Email threading**: the agent reads the email thread it is included on plus attachments in the triggering email only (earlier attachments are inaccessible unless re-attached). It replies **in-thread, only to the sender**; other to/cc recipients never see the answer, and agents cannot initiate email (https://docs.dust.tt/docs/email-agents). So Dust email is a private assistant on a shared thread, not a shared participant.
- **Slack workflow automation**: Dust agents can be invoked from Slack Workflow Builder (scheduled prompts, emoji-reaction triggers) via `@dust +agentName`, but each workflow must be whitelisted manually by Dust support (https://docs.dust.tt/docs/dust-assistants-in-a-slack-workflow).

### Multi-user

- Anyone in a channel the bot is in can @mention it; answers are visible to the whole channel. Teams docs say agents recognize multi-participant exchanges and understand speaker identity within group discussions (https://docs.dust.tt/docs/dust-in-teams).
- **Identity mapping is the sharp edge**: when a Dust agent uses Slack *tools* (posting messages, reading channels as an action), it acts with the invoking user's personal OAuth credentials: "when an agent posts a message or performs an action, Slack sees it as coming from you", and the agent is limited to that user's permission level (https://docs.dust.tt/docs/slack-troubleshooting). Posting under a bot identity instead requires contacting Dust support. Dust also keeps "its own permission layer" controlling which channels sync.
- Email: only verified workspace members can invoke agents by email.

### Approvals through the channel

Not found. Dust's channel model is conversational Q&A over knowledge plus tool use; I found no documented human-approval step that pauses an agent action and asks for confirmation inside Slack/Teams. **[unverified — absence of evidence]**

### Context, limits, gotchas

- Thread-only context; no channel-wide history; "thread links sometimes approximate" for unthreaded messages (https://docs.dust.tt/docs/slack-troubleshooting).
- Semantic search over synced Slack data requires the Slack AI add-on; otherwise keyword-only.
- Editing the Slack app's OAuth scopes/credentials breaks the connection.
- One user email maps to one workspace for email agents (most recently used paying workspace wins on conflict).
- Pricing: Pro is $30/user/month ($24 yearly) with 8,000 credits per seat per month; Slack bot usage counts as programmatic usage against credits (https://dust.tt/home/pricing, https://docs.dust.tt/docs/credits). Whether the Slack/Teams integrations are gated to paid plans is not stated on the pages I fetched. **[unverified]**

---

## 3. Relevance AI (relevanceai.com)

### Positioning: channels are triggers into an agent/workforce run, with live progress streamed back

Relevance AI sits between Lindy and Dust. Like Lindy, a channel message is a **trigger** configured on the agent (Triggers page → new Trigger → pick channel/DM → optional keyword). Like Dust, the resulting exchange is genuinely conversational in the thread, and Relevance uniquely streams **live status updates** of the agent's work into the thread ("automatically enabled... showing you what your Agent is doing in real-time") (https://relevanceai.com/docs/integrations/popular-integrations/slack).

### Channels supported

- **Slack** (https://relevanceai.com/docs/integrations/popular-integrations/slack)
- **Microsoft Teams**, including group chats; messages render as Adaptive Cards (Microsoft's rich message format) with typing indicators (https://relevanceai.com/docs/integrations/popular-integrations/microsoft-teams)
- **Agent Chat / Chat Embed**: an embeddable website widget and shareable hosted chat link per agent, customizable branding, usage billed against credits (https://relevanceai.com/chat-embed, https://relevanceai.com/changelog/introducing-agent-chat)
- **WhatsApp / Telegram**: third-party tutorials show connecting Relevance agents to WhatsApp and Telegram, but I did not find first-party docs pages for these in this pass; treat as **[unverified]** whether they are native channels or assembled via connectors.
- Email exists as tool/trigger integrations (Outlook via the unified Microsoft auth; Gmail) rather than a documented conversational email channel. **[unverified depth]**

### Connection UX

- **Slack**: from the Relevance dashboard, Integrations & API Keys → Slack → Add Integration → OAuth authorize and select permitted channels. There is also a "magic link" flow that shows both account emails for verification (email match between the Slack and Relevance accounts is required). The bot is a single **@Relevance AI** app "installed once for the whole workspace"; it is invited per channel with `/invite @Relevance AI` (https://relevanceai.com/docs/integrations/popular-integrations/slack). Per-agent routing is done in the trigger config (which channel/DM, which keyword), not by bot identity. Two agents can live in one workspace by giving them different channels or different keywords, but they both look like @Relevance AI. Renaming per agent is not documented. **[unverified]**
- **DM support**: DM the bot once to establish the connection; the DM then appears in the trigger's channel dropdown. Configuring a DM trigger requires Editor permissions or higher on the Relevance side (https://relevanceai.com/docs/integrations/popular-integrations/slack).
- **Teams**: two mandatory steps: Microsoft OAuth in the dashboard (one auth covering Teams/Outlook/SharePoint/OneDrive), then adding the Relevance AI app **to every channel and group chat individually** from the Teams app store; workspace-wide install is insufficient. Enterprise tenants may hit "Need admin approval" (Entra ID admin consent) (https://relevanceai.com/docs/integrations/popular-integrations/microsoft-teams).

### Conversation model

- **Slack threads**: mention the bot in a channel to start; the reply comes in a thread; "simply @Relevance AI in thread for your agent to respond, with full context of the conversation". Live status updates land in the same thread (https://relevanceai.com/docs/integrations/popular-integrations/slack).
- **Teams threads have a session TTL**: agent responses are threaded and "active conversation threads last 30 minutes" — after that the session ends and a new mention presumably starts a new one (https://relevanceai.com/docs/integrations/popular-integrations/microsoft-teams). This is the only explicit session-expiry rule I found among the three vendors.
- **Web-app continuity**: every triggered run is a **task** visible in the Relevance app (Task View), where the human can watch and intervene (https://relevanceai.com/docs/build/workforces/workforce-features/approvals-and-escalations). Whether a human can continue the *conversation* from the app back into the Slack thread is not documented. **[unverified]**
- There is a "No Agent Reply" trigger mode where the agent processes messages silently with no Slack confirmation (useful for logging/enrichment rather than conversation).

### Multi-user

The agent receives the triggering message, the full thread history, and the **user identity** of the speaker (https://relevanceai.com/docs/integrations/popular-integrations/slack). Teams docs likewise note multi-participant awareness. Identity mapping between Slack account and Relevance account is enforced at connect time via email matching, but per-message authorization (may this Slack user trigger this agent?) is not documented; scoping appears to be by channel selection at OAuth time and per-trigger channel config rather than per-user RBAC. **[unverified]**

### Approvals through the channel (Relevance's distinctive feature)

Relevance has the most developed approval story of the three, on two layers:

1. **Platform approvals** (workforce level): three modes per action/edge — Auto Run; Approval Required (agent drafts the action and waits); and "Let Agent Decide" (agent self-assesses uncertainty/risk in natural language and requests approval only when unsure). Pending requests, agent reasoning, and approve/reject/give-guidance controls live in the **Workforce Task View** dashboard, with timeout actions/notifications for stale requests, and escalation paths routable to specific humans or other agents (https://relevanceai.com/docs/build/workforces/workforce-features/approvals-and-escalations).
2. **Slack Tool Approval** (channel level): enabled per trigger under Advanced settings ("Tool approval from Slack"). The human can "approve or reject agent tool requests without leaving Slack", reviewing the tool name and parameters and responding with a single click in the thread (https://relevanceai.com/changelog/chat-with-your-ai-agent--and-get-replies--in-slack). This is exactly the "approvals flow through the same channel" pattern Agenta is considering. A Teams equivalent is not documented. **[unverified]**

### Limitations, gotchas, packaging

- Teams: triggers fire only on new messages (not on chat creation or webhooks); most Teams tool steps are marked beta; the 30-minute thread TTL bounds long-running conversations.
- Slack: magic links expire; email match required; per-user OAuth and the workspace bot token are independent auth methods, which is a recurring source of confusion.
- Usage (including chat-embed conversations) draws down usage credits; channel conversations therefore have direct marginal cost, same shape as Lindy.

---

## Cross-vendor synthesis

**Three positions on the same spectrum.** Lindy treats a channel message as a workflow trigger and leaves conversation-ness to configuration. Relevance treats it as a trigger too, but streams run progress into the thread and adds in-channel tool approval. Dust treats the channel as the primary product surface with a shared-team conversation model.

**Nobody does per-agent bot identity.** All three install ONE vendor bot per Slack workspace (@Lindy [unverified], @dust, @Relevance AI) and route to individual agents by syntax (`@dust ~agent`), channel linking (Dust, Relevance triggers), or keyword filters (Lindy, Relevance). No vendor documents two agents appearing as two differently-named Slack bots. This is presumably a Slack platform constraint (one bot user per installed app) that a per-customer app would be needed to escape.

**Thread = session is the universal mapping, with thread-scoped context.** Dust is explicit: the agent sees only the thread it is mentioned in, never the whole channel. Relevance sends full thread history plus speaker identity. Teams adds a 30-minute session TTL at Relevance. Nobody documents cross-surface continuation of one session (Slack thread → web app chat); the web app shows *runs/tasks* (Lindy tasks, Relevance Task View), not a continuable conversation.

**Approvals: email+dashboard (Lindy), dashboard+in-thread Slack buttons (Relevance), absent (Dust).** Relevance's per-trigger "Tool approval from Slack" with parameter review and one-click approve/reject is the closest existing implementation of channel-native approvals.

**Identity is the least-solved problem.** Dust's Slack tools act *as the invoking user* via personal OAuth (actions appear to come from the human). Relevance requires email match between Slack and platform accounts at connect time. Lindy documents nothing. None of the three documents real RBAC over who in a channel may invoke or steer an agent; access control is by channel membership plus bot invitation.

**Email as a channel is rare and asymmetric.** Only Dust has a real conversational email channel (`agent@dust.tt`), and it deliberately replies privately to the sender only, never to the thread — a strong signal that they consider agent-posts-to-a-shared-email-thread too risky. Lindy's email strength is inbox automation (drafts in your Gmail) rather than an agent address.
