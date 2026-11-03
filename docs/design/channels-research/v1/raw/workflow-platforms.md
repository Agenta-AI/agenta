# Channels research: workflow-automation platforms (Gumloop, n8n, Zapier)

Light first-pass competitive research for the Agenta "channels" feature: connecting an
agent to a messaging surface (Slack, Discord, Telegram, WhatsApp, Teams, email) so that
an @mention opens a session, the whole team talks to the agent in a thread, and
approvals flow through the same channel.

This file covers the workflow-automation group: **Gumloop**, **n8n**, and **Zapier**
(Zapier Agents, formerly Zapier Central). These vendors approach chat channels from the
automation side: a chat message is first of all a *trigger event* that starts a
workflow run, and the conversational experience is layered on top with varying depth.
Claims that come from marketing pages or that I could not confirm in documentation are
marked **[unverified]**. Research date: 2026-07-20.

---

## 1. Gumloop

Gumloop is a no-code workflow builder ("flows") that added an agent product in 2025.
Their agents are described as "AI-powered reasoning engines that can use tools to solve
open-ended tasks", where the tools are Gumloop workflows, MCP servers (Model Context
Protocol, a standard for exposing tools to models), and connected apps
(https://www.gumloop.com/blog/announcing-gumloop-agents).

### Positioning of chat channels

Slack is the flagship and, per the docs, the only external chat surface for agents:
"All agents are usable on the Gumloop platform or natively in Slack"
(https://www.gumloop.com/blog/announcing-gumloop-agents). The positioning is
explicitly *team visibility*: the announcement notes that when agents lived only in
the web app, "no one else on their team could see how they did it. Slack exposes that
learning by default." Each Slack thread doubles as a shared, discoverable example of
what the agent can do. No Discord, Telegram, WhatsApp, Teams, or email chat surface is
documented for agents. **[unverified: absence checked only against the core docs and
blog, not the full changelog]**

### Supported channels and depth

From the Slack agents doc (https://docs.gumloop.com/core-concepts/agents_slack):

- Agents work in **public and private channels**, but "not to direct messages (DMs)".
- Conversations are **thread-based**. "You can `@Gumloop` in a top-level message to
  start a new thread, or inside an existing thread to continue."
- Two per-agent thread response modes:
  - **"On All Messages"**: the agent answers every reply in the thread, no @mention
    needed. Recommended for support channels.
  - **"Only on Mentions"** (recommended default): the team can discuss freely in the
    thread; the agent only speaks when explicitly @mentioned.
- **One agent per channel** with the standard `@Gumloop` bot. Multiple agents in one
  channel require deploying separate Custom Slack Apps (a customer-owned Slack app
  wrapping the agent).

### Connection UX

- The user authenticates Slack on Gumloop's Connectors page (OAuth), then clicks
  "Add to Slack" on a specific agent.
- Three ways to attach the agent: create a **new channel**, connect to **existing
  channels**, or use the **`/gummie add`** slash command in Slack.
- The workspace must `/invite @Gumloop` (the shared Gumloop bot) into the channel
  first; the new/existing-channel flows add it automatically.
  (https://docs.gumloop.com/core-concepts/agents_slack)

### Conversation model

- **Slack thread = agent conversation.** A top-level @mention opens a new thread and
  with it a new conversation; mentions inside the thread continue the same
  conversation. This is the cleanest thread-to-session mapping in this vendor group.
- Every agent reply carries an **attribution stamp** that shows the agent identity and
  **links to the full Gumloop conversation** in the web app. So a Slack thread is
  viewable as a first-class conversation on the platform. Whether you can *continue*
  that conversation from the web app and have replies flow back into the Slack thread
  is not documented. **[unverified]**
- Long-term memory / learning across conversations is claimed in marketing ("every
  interaction becomes a learning opportunity") but the mechanics are not documented.
  **[unverified]**

### Multi-user and identity

This is Gumloop's most distinctive design decision. The agent acts **as the invoking
Slack user**, not as the agent creator:

- "The agent uses your personal default credentials (unless team apps are configured),
  not the agent creator's credentials." Identity is resolved by **email matching**: if
  your Slack email matches a Gumloop account, it just works; if not, you get a signup
  prompt requiring the same email in both systems.
- **Team gating**: "When an agent is in a team, users invoking the agent must also be
  members of that team", otherwise they get an access-denied message. Team agents
  require Pro or Enterprise plans.
  (https://docs.gumloop.com/core-concepts/agents_slack)

### Approvals / human-in-the-loop

The agents announcement mentions "agents that know when to ask": agents can "pause at
important moments and check in with you for approval before taking action"
(https://www.gumloop.com/blog/announcing-gumloop-agents). The concrete UX in Slack
(buttons vs plain reply, timeout, who may approve) is not documented in the pages I
reviewed. **[unverified]** Gumloop *flows* also have a human-input node
(Ask Human / approval style nodes) usable inside workflows. **[unverified detail]**

### Triggered runs vs chat

Beyond chat, agents run on **triggers** from "100+ apps" (Zendesk, Stripe, Gmail,
Salesforce, Slack itself, web monitoring), with trigger conditions written in natural
language, e.g. "When a customer opens a support ticket in Zendesk AND has an overdue
invoice in Stripe... then send a Slack message"
(https://www.gumloop.com/blog/trigger-gumloop-agents-with-any-app). The docs do not
distinguish a triggered run from a chat conversation; both use the same agent
definition. The docs also suggest pairing: the agent handles ad-hoc @mention questions
while a separate workflow trigger processes every message in the channel (e.g. for
logging) (https://www.gumloop.com/blog/slack-ai-agents).

### Limitations and gotchas

- No DMs; channels only.
- One agent per channel unless you run Custom Slack Apps.
- Session/memory mechanics undocumented; cross-surface continuation undocumented.
- Email-match identity breaks when Slack and Gumloop emails differ.
- Cost quirks surface in chat (e.g. image generation costs 30 credits per image).

---

## 2. n8n

n8n is a source-available workflow automation tool. Unlike Gumloop and Zapier it has
**no packaged "agent in Slack" product**; instead it gives you the building blocks
(trigger nodes, an AI Agent node, memory sub-nodes, send-and-wait nodes) and the
community wires them together. That makes n8n the best window into what builders
actually assemble by hand, and its human-in-the-loop primitives are the most concrete
in this group.

### Positioning and supported channels

Chat channels are just trigger/action integrations plus a first-party **Chat Trigger**
for n8n's own hosted/embedded chat widget:

- **Slack**: Slack Trigger node (events) + Slack node (actions, including
  send-and-wait). (https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.slacktrigger/)
- **Telegram**: full built-in Telegram Trigger covering "new incoming message of any
  kind — text, photo, sticker", channel posts, callback queries (button clicks),
  reactions, chat-member events.
  (https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramtrigger/)
- **WhatsApp**: built-in WhatsApp Trigger (WhatsApp Business Cloud) for account,
  message, and phone-number events.
  (https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.whatsapptrigger)
- **Discord**: **no built-in trigger**. The built-in Discord node only sends/manages
  messages. Listening to Discord requires a community node
  (https://github.com/katerlol/n8n-discord-trigger) or hand-rolled webhooks. A
  long-standing feature request exists (https://community.n8n.io/t/discord-trigger-node/136314).
- **Email / Teams**: nodes exist for sending, and (like Slack) several messaging nodes
  offer a send-and-wait operation for approvals (see below).
- **n8n Chat Trigger**: a hosted chat page or embeddable widget that is the canonical
  front door for the AI Agent node.
  (https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger/)

### Connection UX

Do-it-yourself. For Slack you create your own Slack app, enable event subscriptions,
point them at n8n's webhook URL, and grant bot scopes (minimum `conversations.list`
and `users.list`; since n8n 1.106.0 you can set a Signing Secret to verify webhook
authenticity). Trigger options include "Watch Whole Workspace" vs a single channel
(workspace-wide "will use one execution for every event in any channel your bot or app
is in") and "Usernames or IDs to ignore" to keep the bot from triggering on its own
posts. A hard Slack platform constraint: "Slack permits only one active webhook per
app", so test and production n8n URLs fight over the same Slack app.
(https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.slacktrigger/)

For Telegram you create a bot with BotFather and n8n registers the webhook; the
trigger can filter to specific chat IDs or user IDs (a crude allowlist).

### Conversation model: the AI Agent node and session keying

The **AI Agent node** is the LLM loop: "Connect a chat model and one or more tools,
and the agent decides which tools to call to complete a task"
(https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/).
Conversation state comes from a **memory sub-node** attached to the agent:

- **Simple Memory** (window buffer): parameters are a **Session Key** ("Enter the key
  to use to store the memory") and a **Context Window Length** ("the number of
  previous interactions to consider for context"). It stores history in-process.
  Critical caveat straight from the docs: "If your n8n instance uses queue mode, this
  node doesn't work in an active production workflow" because calls are not guaranteed
  to hit the same worker.
  (https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.memorybufferwindow/)
- Durable alternatives: Postgres Chat Memory, Redis Chat Memory, MongoDB Chat Memory,
  etc., all keyed by the same session-key concept. **[unverified: list from general
  product knowledge, individual pages not fetched in this pass]**

**How the session key gets its value is the interesting part.** With the Chat Trigger,
the trigger supplies a `sessionId` and the memory node can take it automatically
("Connected Chat Trigger Node" mode). With a Slack/Telegram trigger there is no
built-in session concept, so builders write an expression for the session key from the
event payload. Observed community conventions from popular templates:

- **Per Slack thread**: key on channel + `thread_ts` (Slack's thread timestamp, the
  identifier of the root message of a thread). This is the "@bot in a thread → agent
  with memory → reply in same thread" pattern.
- **Per channel**: one template describes its Simple Memory as keeping "track of
  previous messages per Slack channel" (whole channel shares one session).
- **Per user**: the IT-ops SlackBot template stores "the last five messages from each
  user" (https://n8n.io/workflows/2397-it-ops-ai-slackbot-workflow-chat-with-your-knowledge-base/).
- **Telegram**: key on `chat.id`.

The choice is entirely the builder's; nothing enforces consistency, and switching keys
mid-flight orphans history. A polished 2025-era template
(https://n8n.io/workflows/5749-create-a-slack-ai-chatbot-with-threads-and-thinking-ui-using-openrouter-and-postgres/)
shows the current best practice: it uses Slack's **AI Apps / assistant surface**
(bot scopes `assistant:write`, `chat:write`, `im:history`, event `message.im`),
stores history in a Postgres `chat_histories` table, and drives Slack's native
"thinking" three-dots status while the agent runs. Replying into the right thread is
manual: the builder maps `thread_ts` into the Slack node's reply-in-thread option.

There is no cross-surface continuation story: a Slack-keyed session and a web-chat
session are different keys unless the builder deliberately unifies them.

The Chat Trigger's own session handling: hosted chat or embedded widget, one workflow
execution per message, and a "Load Previous Session" option that requires the Chat
Trigger and the Agent to be connected "to the same memory sub-node". Response modes
include "When Last Node Finishes", "Using Response Nodes", and "Streaming response".
Authentication for hosted chat is none / shared basic auth / n8n user auth
(https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger/).

### Multi-user and identity

Do-it-yourself. The event payload carries the Slack/Telegram user ID and the builder
decides what to do with it (pass it in the prompt, key memory by it, filter on it).
The trigger-level allowlists (Telegram chat/user ID filters, Slack ignore-list) are
the only built-in access controls. There is no notion of mapping a Slack user to an
n8n user, no RBAC on who may talk to the bot, and the agent always acts with the
workflow's stored credentials, never the speaker's.

### Approvals / human-in-the-loop (n8n's strength)

n8n ships a first-class **"Send and Wait for Response"** (internally `sendAndWait`)
operation on its messaging nodes, including Slack, and equivalents on email and other
channel nodes: "Send a message and wait for a response from the recipient before
continuing" (https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.slack).
The workflow execution genuinely pauses (n8n's wait infrastructure) until the human
responds. Three response types:

- **Approval**: approve/disapprove buttons rendered in the message itself.
- **Free Text**: the responder submits a text reply via a form.
- **Custom Form**: the responder fills a builder-defined form.

A **"Limit Wait Time"** option auto-resumes after an interval or at a wall-clock time,
so approvals cannot hang forever. (Response-type and wait-limit details corroborated by
docs snippets surfaced in search and community threads, e.g.
https://community.n8n.io/t/slack-wait-send-and-wait-for-approval-options/67411.)

Gotchas from the community:

- Clicking an approval button opens a browser tab to an n8n-hosted confirmation page
  rather than resolving inline in Slack, which users dislike
  (https://community.n8n.io/t/using-slack-send-message-and-wait-for-response-node-without-opening-in-new-browser/213677).
- The sendAndWait response payload does not include the original Slack message info,
  which makes correlating approvals with threads awkward
  (https://community.n8n.io/t/include-slack-message-information-in-sendandwait-response-output/115173).
- There have been resume-loop bugs (approval message re-sent in a loop,
  https://github.com/n8n-io/n8n/issues/13144).

Since the approval is just a node, builders freely put it *inside* agent workflows
(agent drafts → Slack approval → send), and the AI Agent node can also expose a
human-response tool so the model itself decides when to ask. **[unverified: the
agent-as-tool variant is from general knowledge of n8n's "human fallback" examples]**

### Limitations and gotchas (summary)

- Everything is assembly: threads, dedup, identity, session keys are the builder's
  problem; quality varies template by template.
- Simple Memory silently breaks under queue mode (multi-worker production deployments).
- One Slack webhook per Slack app blocks parallel test/prod environments.
- No built-in Discord trigger; Teams/WhatsApp coverage thinner than Slack/Telegram.
- One workflow execution per inbound message; noisy channels burn executions,
  especially with "Watch Whole Workspace" enabled.

---

## 3. Zapier (Zapier Agents + Human in the Loop)

Zapier has two relevant products. **Zapier Agents** (formerly Zapier Central) is a
standalone agent product where you write instructions and pick a trigger. **Human in
the Loop** is a premium built-in app for classic Zaps (Zapier's workflows) that pauses
a run for human review. The strongest channel story is the approval flow, not the
conversation.

### Positioning and supported channels

Zapier Agents' home surface is the Zapier Agents web app chat. Chat channels appear as
*triggers*: an agent can run "when a new message is posted to a Slack channel" or when
a username/highlight word is mentioned in a public channel
(https://zapier.com/apps/agents/integrations/slack/255638584/initiate-agent-behaviors-in-agents-when-new-messages-are-posted-to-a-slack-channel,
https://zapier.com/apps/slack/integrations/agents). Replies into Slack happen only if
the agent's instructions include a Slack send-message action. There is no documented
native @mention-conversation loop where a Slack thread becomes a persistent agent
session. **[unverified: absence based on help-center coverage reviewed in this pass;
Zapier ships agent features quickly]**

### Connection UX

Standard Zapier app connections: OAuth into Slack once at the account level, then pick
the connection inside the agent's trigger or action. No custom Slack app or webhook
plumbing. Trigger activation is tied to publishing: "Until you publish, your agent
only runs during testing. Publishing activates your trigger"
(https://help.zapier.com/hc/en-us/articles/45394909914381-Set-up-your-agent-s-trigger).

### Conversation model

Agent trigger types (same help article): **On Demand** ("runs when you manually start
it using the Run button or by chatting with it"), **Schedule**, **from a Zap action
step or a Zapier MCP server**, and **App Triggers** (Gmail, Sheets, Slack, ...).

- Chat = On Demand runs in the Zapier Agents web UI. A Slack-triggered run is a
  one-shot behavior execution over the event data; the docs do not describe session
  continuity across Slack messages or memory keyed to a thread.
- Zaps can call agents and "optionally pause the Zap until the Agent responds"
  (https://help.zapier.com/hc/en-us/articles/35859160812685-Start-an-agent-from-a-Zap),
  and agent behaviors can in turn trigger Zaps, so the composition story is
  Zap-centric rather than conversation-centric.
- Cross-surface continuation: not documented. **[unverified]**

### Multi-user and identity

Approvals are gated on Zapier accounts: reviewers "must be Zapier account holders",
selected as "Specific members of my account" or "Anyone", and "you must share this Zap
with your designated reviewers so they have access"
(https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop).
For Slack-triggered agents, the speaker is just trigger data; the agent acts with the
Zapier account's connected credentials.

### Approvals / human-in-the-loop (Zapier's strength)

Two mechanisms:

**a) Instruction-based approvals inside Zapier Agents.** You literally write it into
the agent's instructions: "ask for my confirmation through [messaging app] before
continuing to the next instructions." The agent pauses at that point, can notify you
via email or a messaging app, and "you can return to Zapier Agents to approve or stop
the workflow" (https://help.zapier.com/hc/en-us/articles/41776074420493-Add-approval-steps-to-your-agent-s-instructions).
Note the asymmetry: the *notification* goes out through the channel, but the
*approval click* happens back in the Zapier Agents app.

**b) Human in the Loop (Zaps).** The Request Approval action pauses the Zap and
notifies reviewers by **email** or **Slack** (a specific channel or a specific user;
the blog adds threads and DMs). The Slack message carries interactive
**Approve/Decline buttons with customizable labels**, optional button URLs, and
"dynamic confirmation modals"; reviewers can also be allowed to **edit the submitted
data** before approving. Timeout is explicit: a number plus unit (minutes, hours,
days, weeks), with optional reminders, and an on-expiry policy of **"Skip and
continue"** or **"End run"**. On resolution the step outputs a `Decision` field
(`approved`/`declined`) plus responder identity, which downstream paths branch on.
(https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop,
https://zapier.com/blog/slack-approval-for-ai-automation/). A companion trigger,
"Trigger Zaps when Human in the Loop steps run", lets you fan the review request out
to any other app (https://help.zapier.com/hc/en-us/articles/38733206086925-Trigger-Zaps-when-Human-in-the-Loop-steps-run).
The canonical AI pattern in their marketing: AI drafts an email, a Slack Request
Approval step asks the sales rep to review, approval releases the send.

### Limitations and gotchas

- Human in the Loop is a **premium** app and reviewers need Zapier accounts with the
  Zap shared to them; you cannot hand approval to an arbitrary Slack user.
- Agent chat lives in the Zapier app; Slack is an event source and notification sink,
  not a full conversational surface.
- Instruction-based agent approvals resolve in the Zapier app, not in-channel.
- Community reports of Human in the Loop Slack messages not sending exist
  (https://community.zapier.com/troubleshooting-99/human-in-the-loop-message-to-slack-not-triggering-52513).

---

## Cross-vendor observations

1. **Thread = session is the winning mapping, but only Gumloop productizes it.**
   Gumloop hard-codes "top-level @mention opens a thread/conversation, in-thread
   replies continue it". n8n leaves the session key to the builder (thread_ts is the
   community convention). Zapier does not map Slack conversations to sessions at all.
2. **Two @mention modes cover team dynamics.** Gumloop's per-agent toggle
   (respond-to-everything vs respond-only-when-mentioned) is a small design choice
   that resolves the "agent butts into human discussion" problem cleanly.
3. **Identity models diverge sharply.** Gumloop impersonates the *speaker* (email-
   matched personal credentials, team-membership gating). n8n and Zapier act with the
   *workflow owner's* credentials and treat the speaker as data.
4. **Approvals are where this group is strongest**, and both leaders converge on the
   same shape: message with approve/decline buttons + configurable timeout + explicit
   expiry policy + structured decision output. The weak spot in both n8n and Zapier is
   that the click often bounces the user out of the channel (n8n browser confirmation
   page, Zapier Agents app).
5. **The chat surface and the trigger surface blur.** All three let the same agent be
   @mentioned ad hoc *and* fire on app events; none of them documents a unified
   session across the two.
