# Channels: early findings from the light research pass

Date: 2026-07-20. Status: competitive research. Review copy on Mahmoud's fork; not intended to merge into Agenta-AI/agenta. Phase 1 of the research plan in `README.md`.
Sources: the seven vendor reports in `raw/` (OpenClaw/Hermes, Claude Tag, coding
agents in Slack, workflow platforms, Lindy/Dust/Relevance, mature bot platforms,
Chinese ecosystem). This document synthesizes them so we can agree on direction
before the deep pass.

## 1. What we studied

The feature: connect an Agenta agent to a messaging surface (Slack, Discord,
Telegram, WhatsApp, Teams, email, Feishu/DingTalk/WeCom). Someone @mentions the
agent in a channel, which opens a session. The whole team can talk to the agent in
that thread, every reply lands in the same session, the session can be continued
from other surfaces, and approvals can flow through the same channel.

We surveyed 20+ products across five families: personal agent gateways (OpenClaw,
Hermes), first-party agents in Slack (Claude Tag, Devin, Factory, Codegen, GitHub
Copilot, Charlie, Sentry Seer, plus Linear's agent framework), workflow platforms
(Gumloop, n8n, Zapier), agent platforms like ours (Lindy, Dust, Relevance AI), and
the decade-old bot platforms that solved channel abstraction (Botpress, Voiceflow,
Microsoft Copilot Studio / Azure Bot Framework), plus the Chinese ecosystem (Coze,
Dify/LangBot, and the Feishu/DingTalk/WeCom platform APIs themselves).

## 2. What everyone agrees on (the de-facto standard)

These behaviors appear in essentially every product that does channels seriously.
They are table stakes; a design that deviates from them needs a strong reason.

1. **One thread is one session.** A top-level @mention opens a session; every reply
   in that thread routes to the same session, without re-mentioning the agent.
   Universal across Claude Tag, Devin, Factory, Codegen, Copilot, Linear, Gumloop,
   Dust, Hermes, OpenClaw.
2. **Mention gating in group chats.** In a channel, the agent stays silent unless
   mentioned (or the thread it owns receives a reply). Several products make this
   configurable per agent (Gumloop's "On All Messages" vs "Only on Mentions";
   OpenClaw's mention gating; Charlie's watch conditions are the extreme end).
3. **Context is thread-scoped.** The agent reads the thread it lives in, not the
   whole channel. Claude Tag caps at 50 thread messages plus pinned items; Dust is
   explicit that nothing outside the thread is visible. Nobody feeds channel-wide
   history by default (privacy and cost both push this way).
4. **Progress streams back into the thread.** Status messages, emoji reactions, or
   native "thinking" indicators. Relevance streams live run status by default;
   Linear formalizes it as a typed activity stream (`thought` / `action` /
   `elicitation` / `response` / `error`) from which session state is derived.
5. **Fast acknowledgment matters.** Linear enforces it as an SLO: acknowledge
   within 10 seconds or be flagged unresponsive. Slack's event API similarly
   retries on slow responses. The runtime needs an ack-first, work-later shape.
6. **A normalized message schema with per-channel translators.** The mature
   platforms all converge on a small type vocabulary (text, buttons/choices, card,
   media) plus a channel-native escape hatch (Bot Framework's `channelData`,
   Botpress's namespaced tags) because normalization is always leaky. The
   vocabulary has been stable for a decade and is safe to adopt wholesale.
7. **Session keying by native channel IDs behind one interface.** `(channel id,
   conversation/thread id)` maps to a session. n8n makes builders hand-write this
   key (usually channel + Slack `thread_ts`); everyone else productizes it.

## 3. The design forks (where vendors genuinely disagree)

### Fork A — group sessions: shared or per-user?

- **Shared thread session** with speaker attribution: OpenClaw (one session per
  group, `GroupMembers` and speaker metadata passed to the agent), Claude Tag
  (anyone in the thread steers, collective memory), all the coding agents.
- **Per-user-per-channel isolation**: Hermes's Slack default (each person gets a
  private history even in a shared channel).

Mahmoud's described UX ("the whole team can chat with the agent... if someone
answers there it goes to the same session") is the shared model. The shared model
needs one safety rule the per-user model gets free: a group-visible reply must not
use resources only one member may access (Copilot Studio forbids user-authenticated
knowledge sources in group chats for exactly this reason).

### Fork B — whose identity does the agent act under?

Three answers exist in the wild, and this is the deepest fork:

- **(a) The invoking user.** The agent impersonates whoever asked, capped at their
  permissions. Gumloop (personal credentials via Slack-email matching), GitHub
  Copilot, Codegen, Dust's Slack tools. Gives clean attribution and least
  privilege, but requires every user to link accounts, and email-match linking is
  brittle (Devin's silent failures).
- **(b) A shared service account** scoped per channel/workspace/org. Claude Tag's
  whole model: admin provisions once, zero per-user setup, but no per-person
  attribution and everyone in the channel gets the same powers. Factory's
  per-channel "Run as" is the same idea.
- **(c) The agent as its own first-class identity.** Linear's `actor=app`: the
  agent is an app user with its own permissions; humans remain accountable as
  assignees. Auditable and simple; no user linking needed.

These compose rather than exclude: several products do (c) for the agent's own
actions while passing speaker identity as context, and add (a) per-user linking
later for tools that need it.

### Fork C — one platform bot per workspace, or one bot per agent?

Nobody ships per-agent Slack bot identity. Lindy, Dust, Relevance, Gumloop all
install one vendor bot per workspace and route to agents by syntax (`@dust
~agentname`), channel-to-agent linking (a channel's default agent), or keyword
filters. Giving each agent its own name and avatar requires the customer to create
their own Slack app (Coze makes customers do this; Gumloop offers it as the
escape hatch for multiple agents in one workspace). Dust's routing design (one bot,
inline agent selector, per-channel default agent) is the cleanest reference.

### Fork D — are DMs allowed?

Dust refuses Slack DMs on principle ("channels provide shared context"); Lindy,
Relevance, Hermes, OpenClaw allow them; Claude Tag allows them but bills DMs to the
individual seat and keeps them private. DM policy also interacts with identity:
a DM is unambiguous personal context, a channel is shared context.

### Fork E — session lifetime

Mostly undocumented. The observed extremes: Claude Tag's threads stay resumable
indefinitely (persistent thread, ephemeral sandbox rebuilt on demand) while
Relevance kills Teams sessions after 30 quiet minutes. Devin adds an explicit
`!new` keyword to force a fresh session in a thread. Timeout/stale semantics are
an open design point almost everywhere (only Linear defines a `stale` state).

## 4. White space (what nobody ships)

These are the parts of Mahmoud's described feature that no surveyed vendor has,
which makes them the differentiation candidates:

1. **Cross-surface session continuity.** Continuing the same session from Slack in
   the web app (or another channel) essentially does not exist. Factory is the
   best partial (thread links out to its web app, and pasting a Slack thread URL
   imports it); Hermes does it for one operator (global session IDs, `--resume`,
   `/handoff`). No team product does it, and the bot platforms show why: nobody
   has cross-channel identity linking. Agenta already has sessions as a core
   concept, so this is our natural edge, but it requires explicit account linking
   (channel user to Agenta user), not heuristics.
2. **Fully in-channel approvals.** n8n and Zapier have approve/decline buttons but
   bounce the approver to a browser (their top complaint); Lindy approves via
   email link; Claude Tag has no approval step at all (safety = service-account
   scoping); the bot platforms have the buttons but no approval product. The one
   real implementation is Relevance's "tool approval from Slack" (approve/reject a
   tool call with parameter review inside the thread). Agenta already has an
   approval model in the agent runtime, so surfacing it as native channel buttons
   that resume the run without leaving the channel is both feasible and rare.
3. **Per-user RBAC on trigger and approve.** Everywhere, "who may talk to the
   agent" is just channel membership, and "who may approve" is not even modeled as
   distinct from "who may trigger". Zapier is the only one that gates approvers
   (they need Zapier accounts). Roles like "anyone may ask, only maintainers may
   approve" exist nowhere.
4. **A typed activity/event protocol for channel rendering.** Everyone else posts
   unstructured messages. Linear's protocol (typed activities, derived session
   states, `elicitation` as the waiting-for-input primitive) is the design to
   study; Agenta's existing SSE frame stream is structurally close to it already.

## 5. Channel priority facts

Setup cost ladder, consistent across all reports (cheapest first): Telegram (paste
one BotFather token) → Discord (token + intents) → Slack (OAuth app install or
manifest paste; Socket Mode avoids needing a public endpoint) → Teams (free but
organizationally heavy: admin center upload, tenant policy, Entra consent) → email
(only Microsoft and Dust do it first-party; Dust replies only privately to the
sender) → WhatsApp (Meta business verification, days to weeks, template approval,
or hide behind Twilio).

Capability notes that shape design:

- Slack: threads, buttons, and a paid-plan-only native "AI app" side panel; scope
  changes force reinstall; slash commands do not work inside threads.
- Teams: threads exist; three-button card cap on WhatsApp-style limits elsewhere
  (Copilot Studio publishes a per-channel capability matrix rather than pretending
  translation is lossless; we should do the same).
- Feishu/Lark is the standout Chinese channel: mention-gated group events, real
  threads, streaming "typewriter" cards, card-button approvals, WebSocket
  delivery, rich identity, and no platform review for self-built tenant apps.
- DingTalk and WeCom have Slack-like bot APIs with streaming and approval-capable
  cards but no threads; WeCom needs a verified Chinese enterprise tenant.
- Personal WhatsApp/WeChat via unofficial bridges is ban-risk grey area
  (OpenClaw's QR pairing; the dead WeChat bridge ecosystem) and out of scope for
  a SaaS.

One architecture note from the self-hosted world: OpenClaw and Hermes both run a
single gateway process that owns all platform connections and forwards normalized
events to the agent runtime. OpenClaw's security collapse (30k exposed gateways,
one-click RCE, malicious skill registry) is the cautionary tale for shipping that
gateway as a hosted, hardened service rather than user-run infrastructure. Their
post-crisis rules (identity first, scope and sandbox second, assume prompt
injection from channel content) transfer directly.

## 6. Direction questions for Mahmoud

1. **Group session default (Fork A).** Recommend: shared session per thread with
   per-message speaker attribution, matching your described UX, plus the group
   safety rule (no member-private resources in group-visible replies).
2. **Identity (Fork B).** Recommend: agent acts under its own identity (c) with
   speaker identity passed as context, because it needs zero per-user setup and
   stays auditable; add optional per-user account linking later where tools need
   the invoker's permissions. Alternative: Claude Tag's service-account model (b)
   if we want admin-provisioned credentials per channel from day one.
3. **Bot-per-workspace vs bot-per-agent (Fork C).** Recommend: one Agenta bot per
   workspace with Dust-style routing (channel default agent + inline selector),
   with "bring your own Slack app" as the later escape hatch for named bots.
4. **Channel order.** Recommend: Slack first (it is where our users' teams live
   and where every competitor is), Telegram second because it is nearly free to
   add and forces the channel abstraction to be real (two channels keep us
   honest), then Teams/Discord/email by demand. WhatsApp and the Chinese
   channels only with a concrete customer pull. Is the Chinese ecosystem a real
   near-term target or a nice-to-have?
5. **Approvals in v1?** Recommend: yes, in-channel approval buttons wired to our
   existing approval model, because it is the clearest differentiator and we
   already have the runtime half. Question: approvals-for-everyone in the thread,
   or roles (trigger vs approve) from the start?
6. **DM policy (Fork D).** Recommend: channels-only in v1 (Dust's stance), DMs
   later once identity linking exists, because DMs force the personal-context and
   billing questions immediately.
7. **Scope check on sessions.** The whole design rides on our existing session
   model accepting messages from an external surface with speaker metadata, and
   multiple humans writing into one session. The deep pass should audit our
   session API against that before the RFC.

## 7. What the deep pass covers (after direction is agreed)

- Audit of Agenta's session/agent runtime against the channel contract (multi
  writer sessions, speaker attribution, ack-first event flow, approval surfacing).
- The gateway architecture: normalized message schema, translator per channel,
  `channelData`-style escape hatch, session keying, delivery (Socket Mode vs
  public webhooks), multi-tenant Slack app design and Enterprise Grid mapping.
- Approval protocol detail: Linear's elicitation model, Relevance's Slack tool
  approval, mapping to our SSE frames.
- Per-vendor open questions listed at the end of each `raw/` file.
- Then `report.md` + `first-principles-design.md`, like the MCP gateway project.
