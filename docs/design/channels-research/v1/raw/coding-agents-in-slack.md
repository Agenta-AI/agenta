# Coding agents in Slack and Linear: how competitors do "channels"

This document is a first-pass (breadth over depth) survey of how work and coding agents connect to team messaging surfaces. The feature under study, which we call "channels," is the ability to attach an agent to a place where a team already talks (a Slack channel, a Microsoft Teams channel, a Linear issue, an email inbox). A team member mentions the agent by name (an "@mention"), the mention opens a working session, everyone in the thread can talk to the agent, all replies land in the same session, and the session can also be continued in the vendor's own web application. Some vendors additionally route approvals (a human confirming an agent's plan or action before it proceeds) through the same thread.

Vendors covered: Devin (Cognition), Factory.ai, Codegen, Charlie Labs, Linear's agent framework, plus two briefer examples that fit the pattern: GitHub Copilot's cloud agent in Slack and Sentry's Seer Agent in Slack.

All claims below come from vendor documentation or vendor blog posts, cited inline. Where the documentation is silent or a claim could not be confirmed, it is marked **[unverified]**.

---

## 1. Devin (Cognition)

Devin is Cognition's autonomous software engineer: a hosted agent that takes a task, works in its own cloud development environment, and ships pull requests. Source for this section: the official Slack integration page at https://docs.devin.ai/integrations/slack and the Slack Marketplace listing at https://slack.com/marketplace/A06A3TU8H39-devin.

**Positioning.** When mentioned in a Slack channel, Devin treats the mention as a task assignment. It spins up a full working session (the same kind of session you would start from Devin's web app) and reports back in the thread. The pitch is "delegate engineering tasks without leaving Slack."

**Channels supported.** Slack only, as the messaging surface. Devin also integrates with Linear through Linear's agent framework (see section 5). No Microsoft Teams or email channel is documented. Within Slack, Devin works in channels, threads, and via direct-message notifications for status updates.

**Connection UX.** An organization admin goes to Settings > Connections > Slack in the Devin app and clicks "Connect," which installs the Devin Slack app into the workspace through Slack's standard OAuth flow. Critically, the install is two-level: after the org-level install, every individual user must also link their account, and the linking is done by email matching — the docs require that "your Slack email is the same as your email in app.devin.ai/settings" (https://docs.devin.ai/integrations/slack). So identity mapping between the Slack user and the Devin account is automatic but brittle: it depends on the two systems agreeing on the email address.

**Conversation model.** Tagging @Devin in any channel or thread launches a session, and "Devin will respond in-thread to your session. Now, you can communicate back and forth as you would in the regular chat interface" (https://docs.devin.ai/integrations/slack). The thread is the session: subsequent messages in the thread continue the same session. Devin recognizes control keywords placed immediately after the mention: mode keywords (`!fast`, `!lite`, `!ultra`, `!agent`) select how much compute/autonomy the session gets, and `!new` forces a fresh session instead of continuing the thread's existing one. Sending a mode keyword into an active thread switches that session's mode mid-flight. Sessions started from Slack appear in the Devin web app like any other session, and users can enable per-run Slack notifications so Devin privately DMs them on status changes; marketing material describes viewing progress and requesting changes from either surface **[unverified: the docs page we fetched does not spell out the exact web-continuation flow, only the marketplace/product pages imply it]**. Completion and failure are signaled with emoji reactions on the triggering message.

**Multi-user.** Any workspace member whose email matches a Devin account can trigger @Devin; the docs describe no finer-grained role controls over who may trigger. Because the session lives in a public thread, anyone in the thread can send follow-up messages to steer the run — the docs describe back-and-forth communication without restricting it to the original requester **[unverified: the docs do not explicitly state whether non-initiators' messages are accepted]**. There is no documented approval RBAC (role-based access control, i.e., rules about which roles may perform which actions).

**Approvals.** Devin has a global "Agency" setting: when Agency is turned off, "Devin will wait for you to approve its plan before proceeding" (surfaced in Devin's customization settings; see https://docs.devin.ai/release-notes/overview). Settings > Customization also controls whether Slack-triggered sessions start in existing or new threads and whether Devin waits for plan approval. So plan confirmation exists as a per-org configuration and the confirmation conversation happens in the thread, rather than as a per-message approval protocol.

**Context received.** Devin's Slack permissions include "View messages and other content in channels, groups, and DMs that Devin is in," so it can read the thread it was mentioned in, plus attachments included with the mention. Session context is thread-bound; there is no documented channel-wide memory.

**Limitations and gotchas.** Every user must individually link their account, and email mismatch silently breaks identity mapping. Session lifecycle keywords (`mute`, `archive`, `EXIT`) are magic words typed into the thread, which is easy to trip over. The richer sidebar "AI app" experience requires a paid Slack plan; plain mentions work on free plans.

---

## 2. Factory.ai

Factory builds "Droids," software-development agents that run across web, IDE, CLI, and Slack. Sources: https://docs.factory.ai/integrations/slack and the product page https://factory.ai/product/slack.

**Positioning.** Mentioning @Factory in a Slack thread starts a Droid session that can investigate, code, and post results (messages, generated files, artifacts, even short result videos) back into the thread. Factory leans on Slack for incident response as a headline use case: a Droid sits in the incident channel and does the investigation while the humans coordinate.

**Channels supported.** Slack is the documented messaging surface (plus web, desktop, IDE, and CLI as first-party surfaces). No Teams or email channel is documented. Within Slack: channels and threads; the bot must be invited per channel.

**Connection UX.** An admin connects Slack from Factory's organization settings (Settings → Organization → Slack), goes through Slack OAuth, then invites the bot to each relevant channel with `/invite @Factory`. Factory adds an unusually deep per-channel configuration layer: for each enabled channel an admin can set "Run as" (which identity the sessions run under), machine type, which Droid computer or workspace is used, session visibility, the default model, a custom prompt, and whether the channel is in incident-response mode (https://docs.factory.ai/integrations/slack). The "Run as" option supports service accounts: instead of running with the identity and machines of whichever user mentioned the bot, all sessions from that channel run under a shared preconfigured service account. This is the most developed answer we found to "whose identity does a channel-triggered run use."

**Conversation model.** Mentioning @Factory in a thread starts a Droid session seeded with the entire thread history. Factory replies with "a link to open the conversation in Factory," so the session is explicitly continuable in the web or desktop app — this is a first-class mention-to-session-to-web handoff. The reverse direction also works: a user can paste a Slack thread URL into a Factory chat and the thread is imported as context. The Droid posts messages, files, and artifacts back into the thread as it works; the docs do not detail fine-grained live status streaming (for example a step-by-step progress ticker) **[unverified]**.

**Multi-user.** Not directly addressed in the docs. The channel-level "Run as" service account decouples the run's identity from the mentioning user, which implicitly supports many humans sharing one agent identity in a channel. Per-user identity mapping mechanics are not documented **[unverified]**. Admin rights in both Factory and Slack are required to install or reconnect the integration.

**Approvals.** No thread-level approval or plan-confirmation flow is documented for the Slack surface **[unverified whether Factory's general permission prompts surface into Slack]**.

**Context received.** Full thread conversation history on import, image attachments, and securely parsed Slack links (a link shared in the thread is fetched and used as context). Channel-level custom prompts inject standing instructions per channel.

**Limitations and gotchas.** The bot must be invited per channel or calls fail with a `not_in_channel` error. File and video upload require re-consenting to refreshed Slack permission scopes after upgrades. Install and channel configuration are admin-only.

---

## 3. Codegen

Codegen is a hosted coding-agent platform whose agents work from Slack, GitHub, and Linear. Source: https://docs.codegen.com/integrations/slack.

**Positioning.** @codegen in a channel or thread hands the agent a task (code changes, research, repo questions); the agent runs in Codegen's cloud and reports back into the thread.

**Channels supported.** Slack (channels, threads, and direct messages), plus GitHub and Linear as separate integrations. No Teams or email.

**Connection UX.** A team creates a Codegen account, goes to Integrations > Slack, and connects the workspace via the Slack Marketplace/OAuth flow; the bot is then invited to channels with `/invite @codegen`. Identity mapping is explicit and email-based: Codegen requests the Slack permission to "view workspace members and email addresses" specifically to "map Slack user accounts to Codegen accounts for proper authentication and permission management" (https://docs.codegen.com/integrations/slack).

**Conversation model.** Three triggers: a direct @codegen mention in a channel, a tagged reply inside a thread, or a DM. The thread is the session: "sending subsequent messages within a thread routes to the same agent." A notable wrinkle: a new @codegen message in an active thread interrupts the agent if it is currently working — steering and interruption are the same gesture. Codegen posts notifications into the thread when it starts, when it receives additional messages mid-run, and when it finishes. The web app has a "Recents" page (https://codegen.com/recents) where runs are auditable; the docs do not describe continuing the conversation from the web app back into the thread **[unverified]**.

**Multi-user.** The key design decision: the bot has no independent permissions. "Actions are governed by the permissions of the user who initiated the interaction" — repository access derives from the initiating user's linked account. This is per-initiator identity delegation, the opposite pole from Factory's shared service account. Anyone in a channel where the bot is present can trigger it; access control is done by choosing which channels the bot is invited to, not by user roles.

**Approvals.** No in-thread approval or plan-confirmation mechanism is documented. The docs fall back on "AI-generated code should be reviewed before deployment."

**Context received.** In a thread, the full thread including shared media. Mentioned outside a thread, only the single mentioning message — no channel-wide history. In DMs, the DM conversation. Private channel names are anonymized to non-members.

**Limitations and gotchas.** Mid-run mentions interrupt work. Context never extends beyond the thread. Message content is processed by third-party LLM APIs (OpenAI, Anthropic), which security reviewers will ask about.

---

## 4. Charlie Labs

Charlie is an autonomous software engineer that works across GitHub, Linear, and Slack; the company's current headline feature is "daemons," standing always-on agent processes. Sources: https://docs.charlielabs.ai/integrations/slack, https://charlielabs.ai/, and the Linear integration listing https://linear.app/integrations/charlie.

**Positioning.** @Charlie in Slack is a bridge between conversation and the engineering system of record: "create a Linear issue from this bug," fetch git or Sentry context into the thread, propose a fix with code samples, open a pull request, or summarize a thread with action items. Less "run a long coding session in this thread," more "turn this conversation into tracked engineering work."

**Channels supported.** Slack (mentions, thread replies, channel messages, and DMs), GitHub (PRs, issues, reviews), and Linear (as a native Linear agent since May 2025, per https://www.charlielabs.ai/changelog?entry=2025-05-29-linear-agent). No Teams or email documented.

**Connection UX.** Connect Slack from Charlie's integrations dashboard via OAuth, then connect a GitHub organization/repository in organization settings. Per-user identity mapping between Slack users and Charlie accounts is not documented **[unverified]**.

**Conversation model.** Mentions trigger work and Charlie replies in the thread. Beyond mentions, Charlie's daemons can subscribe to Slack events via "watch" conditions — mentions and thread replies, broader channel messages, or DMs — so an agent can act on a channel without being mentioned at all (for example, auto-triaging every message in a bug-reports channel). This event-subscription model is a step beyond mention-triggered sessions. A thread-equals-session mapping and web-app continuation are not explicitly documented **[unverified]**.

**Multi-user, approvals.** Not documented for the Slack surface **[unverified]**. On the Linear surface, Charlie inherits Linear's session and guidance model (section 5). The docs warn that channel constraints on daemons are "not integration mappings" and recommend narrowing broad message triggers to intentional channels — i.e., scoping is the operator's job.

**Context received.** The thread it is invoked in, plus context Charlie fetches itself from GitHub, Linear, and Sentry (its differentiator is stitching those systems together in its replies).

**Limitations and gotchas.** Docs are thin on identity, permissions, and session mechanics; a broad daemon watch condition on channel messages is an easy way to build an over-eager bot.

---

## 5. Linear agents (the strongest analog for the channel model)

Linear is not a coding-agent vendor; it built a framework so that third-party agents (Devin, Cursor, Charlie, Codegen, and others) become @mentionable, assignable members of a Linear workspace. This is the most fully specified version of "mention an agent in a team surface and a session opens," so it deserves the most attention as a design reference. Sources: https://linear.app/developers/agents (setup), https://linear.app/developers/agent-interaction (session protocol), https://linear.app/developers/aig (interaction guidelines), https://linear.app/docs/agents-in-linear (user-facing docs), and https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk.

**Positioning.** An agent installed in a Linear workspace appears as a workspace member. Users @mention it in issue comments or delegate an issue to it; the agent then works and reports progress inside the issue's activity feed.

**Connection UX.** The agent is an OAuth application installed with an `actor=app` parameter, meaning it authenticates as itself (an "app user") rather than impersonating the installing human. Installation requires a workspace admin, who also selects which teams the agent can access. Two scopes shape the surface: `app:mentionable` puts the agent in the mention menu, and `app:assignable` lets it be set as a delegate on issues. Agents do not count as billable seats, and they cannot request admin scope, sign in to the app, or manage users. Name collisions with human users are auto-suffixed (a second "Charlie" becomes "Charlie1").

**Conversation model — the AgentSession protocol.** When an agent is mentioned or delegated an issue, Linear automatically creates an `AgentSession` object and sends the agent a webhook containing the session plus a structured `promptContext` (issue details, comments, and any configured guidance). The agent must acknowledge within seconds — the guidelines require an initial `thought` activity within 10 seconds, and webhook responses within 5 — and then streams its work as typed activities: `thought` (reasoning/progress notes), `action` (a tool invocation, with optional result), `elicitation` (a request for user input or confirmation), `response` (final result), and `error`. Linear derives the session state (`pending`, `active`, `awaitingInput`, `error`, `complete`, `stale`) automatically from the activity stream, so users always see whether the agent is working, blocked on them, failed, or done. Follow-up comments from users arrive as `prompted` webhook events into the same session. Agents can attach `externalUrls` pointing at their own dashboard — the sanctioned "continue in the vendor's web app" hook — and can attach pull-request URLs. Cursor's integration (https://linear.app/now/how-cursor-integrated-with-linear-for-agents) shows the intended result: assign or mention Cursor, watch its thoughts and to-dos stream into the issue, follow up in the same session.

**Multi-user.** Once installed, any user with access to the agent's teams can mention or delegate to it; there is no per-user linking step because the agent acts as itself, not as the requesting user. The accountability rule is explicit: "the human assignee remains responsible for the issue, even after delegation to an agent" — the agent is a delegate, not the owner. Anyone watching the issue can comment into the session. Behavior is steered at two levels of standing instructions ("guidance"): workspace-level and team-level, with team guidance taking priority.

**Approvals.** The `elicitation` activity type is a first-class "ask a human before proceeding" primitive, and the `awaitingInput` state makes the pause visible in the UI. This is the cleanest formalization we found of approvals inside the channel surface.

**Limitations and gotchas.** The protocol imposes real-time obligations (acknowledge fast or be flagged unresponsive/stale). The agent's own permissions are workspace-scoped app permissions, so anything requiring per-user authority (for example, acting in GitHub as the requesting person) must be solved outside Linear.

---

## 6. Briefer examples

### GitHub Copilot cloud agent in Slack

Source: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/integrate-cloud-agent-with-slack and https://github.blog/changelog/2025-10-28-work-with-copilot-coding-agent-in-slack/. The GitHub App for Slack must be installed by an admin; each user links their GitHub account on first use, and "Copilot uses the permissions of your linked GitHub account for any actions it takes" — per-initiator identity delegation like Codegen, with a write-access requirement on the target repository as the trigger permission. Mentioning `@GitHub Copilot` in a thread (or DMing `@GitHub`) starts a cloud agent session; "Copilot cloud agent will capture the entire thread as context," and that context is stored in the resulting pull request. Users can set a per-channel default repository via `@GitHub settings`. Deliverable is a pull request, so the approval surface is GitHub PR review, not the Slack thread. The docs describe no in-thread live progress stream and no web continuation of the session **[unverified whether the session appears in github.com's agents panel]**.

### Sentry Seer Agent in Slack

Source: https://blog.sentry.io/introducing-seer-agent/ and https://docs.sentry.io/product/ai-in-sentry/seer/. Seer is Sentry's debugging agent; in Slack (open beta) it can be DMed or mentioned in an incident channel, and Sentry alert messages carry a "Fix with Seer" button that kicks off the fix workflow directly from the notification. Setup is `/sentry link` to connect accounts. Its multiplayer story is explicitly channel-native: "anyone in the channel can redirect it mid-step, add context the agent didn't have, or just watch the traversal and learn the system," and investigation threads persist as searchable documentation. On paid Slack plans it also appears in Slack's native AI-assistant side panel for private conversations. This is the best articulation we found of the "whole team steers one run in the thread" value proposition.

---

## 7. Cross-vendor patterns (synthesis)

1. **Thread = session is universal.** Every vendor maps one messaging thread to one agent session, with follow-up messages routed into the same session. Escape hatches differ: Devin has `!new`, Codegen treats mid-run mentions as interrupts, Linear formalizes follow-ups as `prompted` events.
2. **Identity mapping is the hard part, with three distinct answers.** (a) Per-user email/OAuth linking, agent acts with the initiator's permissions (Codegen, GitHub Copilot, Devin's email matching). (b) A channel-level shared service account (Factory's "Run as"). (c) The agent as a first-class app user acting under its own workspace permissions, with no per-user linking (Linear). Nobody documents mixing these.
3. **Web continuation exists but is shallow almost everywhere.** Factory posts an explicit "open in Factory" link per session; Linear standardizes it as `externalUrls`; Devin sessions appear in its web app; Codegen only offers an audit page; Copilot offers nothing documented.
4. **Progress streaming is mostly unstructured messages plus emoji.** Only Linear defines a typed activity stream (thought/action/elicitation/response/error) with derived session states. Slack-native vendors post ordinary messages and reactions.
5. **Approvals are configuration, not protocol — except in Linear.** Devin's plan-approval is a global Agency toggle; most vendors punt approvals to PR review on GitHub. Linear's `elicitation` + `awaitingInput` is the only first-class in-channel approval primitive found.
6. **Trigger permission is mostly "anyone in the channel."** Access control is done by choosing which channels the bot joins (Codegen explicitly recommends this), by requiring repo write access (Copilot), or by team-level install scoping (Linear). No vendor documents per-user "may trigger" vs "may approve" roles.
