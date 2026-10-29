# Channels research, raw notes: OpenClaw and Hermes

This document is a light first-pass competitive study of two products that connect an AI agent to messaging surfaces ("channels"): OpenClaw and Hermes Agent. The feature under study is: a user mentions an agent in a chat channel, that opens an agent session, everyone in the thread can talk to the agent, every reply lands in the same session, the session can continue on other surfaces, and approvals (human confirmation of agent actions) can flow through the same channel. Findings are structured by vendor and then by the study template. Source URLs are cited inline. Anything not verified against a primary source is marked **[unverified]**.

Research date: 2026-07-20.

---

## Vendor 1: OpenClaw

### What the product is and how it positions channels

OpenClaw is an open-source, self-hosted "personal AI assistant" created by Peter Steinberger. It launched in November 2025 under the name Clawdbot, was briefly renamed Moltbot, and is now OpenClaw. It is the fastest-growing project of its kind: the GitHub repository (https://github.com/openclaw/openclaw) has roughly 383,000 stars and 80,000 forks as of July 2026 (verified via the GitHub API). In February 2026 Steinberger joined OpenAI and the project moved to an independent foundation with OpenAI backing **[unverified, widely reported]** (https://www.teacherandtask.com/blog/how-peter-steinberger-built-openclaw-viral-ai-agent).

The product's core architectural idea is the **Gateway**: a single long-lived process, running on hardware the user controls (a laptop, home server, or VPS), that "owns all messaging surfaces" and serves every configured channel plugin simultaneously (https://docs.openclaw.ai/, https://docs.openclaw.ai/concepts/architecture). Channels are not an add-on; they are the product's front door. The positioning is "message your own agent from the chat apps you already use." The agent behind the gateway is a Claude-style coding/personal agent that can run shell commands, browse, manage files, and send messages.

Important framing for Agenta: OpenClaw is explicitly a **personal, single-operator** product. Its security docs state it is "not a hostile multi-tenant security boundary for multiple adversarial users sharing one agent or gateway" (https://docs.openclaw.ai/gateway/security). Team use is possible (group chats, per-peer session scoping) but the trust model is one owner per gateway.

### Channels supported and depth per channel

The channel catalog (https://docs.openclaw.ai/channels) lists 28 platforms in three tiers:

- **Built into the core install:** Telegram (Bot API via the grammY library), iMessage (native macOS bridge), and WebChat (the gateway's own browser UI over WebSocket).
- **Official plugins**, installed with `openclaw plugins install @openclaw/<id>`: WhatsApp, Discord, Slack, Signal, Microsoft Teams, Google Chat, Matrix, Mattermost, IRC, LINE, Feishu, Nextcloud Talk, Nostr, QQ Bot, SMS, Synology Chat, Twitch, Voice Call, Zalo, Zalo Personal, and others.
- **External/community plugins:** WeChat, Yuanbao, and more. There is also a bundled "Reef" plugin for end-to-end encrypted agent-to-agent messaging.

Depth varies by channel and the catalog page is explicit that "text is supported everywhere; media and reactions vary by channel." Notable per-channel depth from the groups documentation (https://docs.openclaw.ai/channels/groups):

- **Threads:** Slack, Mattermost, and Tlon support "bot joined the thread" as an implicit mention (the bot follows a thread it is part of). Telegram forum topics get their own sessions (see conversation model below).
- **Replies and quotes as implicit mentions:** replying to the bot counts as a mention on Discord, Teams, Slack, and Telegram; quoting the bot counts on WhatsApp and Zalo.
- **Reactions:** used as approval affordances at least on Matrix (checkmark/infinity/cross emoji to approve/always-allow/deny an exec approval; https://docs.openclaw.ai/tools/exec-approvals). Broader reaction ingestion varies by channel and was not verified per channel in this pass **[unverified]**.
- **Voice and attachments:** supported on major channels; the catalog defers per-channel specifics to each channel's page **[unverified per channel]**.

### Connection UX

Each channel has its own wiring, done in the gateway's JSON config or via CLI wizards on the self-hosted box:

- **Telegram:** paste a Bot API token (BotFather bot).
- **WhatsApp:** QR-code pairing of a real WhatsApp account through a WhatsApp Web-protocol bridge (the same approach as the Baileys library); the linked account's credentials persist on disk. **[unverified detail: the exact library]**
- **Slack/Discord/etc.:** create a platform app/bot and paste tokens into the plugin config.
- **iMessage:** native macOS integration via a local `imsg` bridge or an SSH wrapper to a Mac.
- **WebChat:** no wiring; it is the gateway's own UI.

Everything runs through the user's self-hosted gateway process; there is no hosted connect flow, no OAuth-style "add to Slack" button hosted by a vendor. The gateway binds to loopback by default and can be exposed via Tailscale Serve, LAN binding with token auth, or a reverse proxy (https://docs.openclaw.ai/gateway/security).

### Conversation model: message-to-session mapping

OpenClaw routes every inbound message to a session keyed by where the message came from (https://docs.openclaw.ai/concepts/session):

- **DMs:** by default, ALL direct messages from every channel land in one shared "main" session. This is a deliberate design for cross-device continuity: you can start a conversation in Telegram and continue it in iMessage or WebChat, because they are literally the same session. The `session.dmScope` setting changes this: `main` (default), `per-peer` (one session per human across channels), `per-channel-peer` (per channel plus human, the recommended multi-user setting), `per-account-channel-peer`.
- **Group chats:** each group gets its own isolated session with key `agent:<agentId>:<channel>:group:<id>`. Everyone in the group shares that one session, so the whole team talks to the agent in a single shared context.
- **Telegram forum topics:** each topic within a group is its own session (`group:<id>:topic:<threadId>`), which is the closest thing to thread-scoped sessions.
- **Cron jobs and webhooks:** fresh/isolated sessions per run/hook.

Cross-surface continuity therefore exists for DMs by default (the shared main session) but not for group sessions, which are pinned to their group. A related mechanism, "channel docking," moves the current direct-chat session's reply route to another linked channel without starting a new session (https://docs.openclaw.ai/concepts/session), meaning the agent's replies follow you to a different surface mid-conversation.

Sessions do not auto-reset by default; long conversations are handled by context compaction and tool-result pruning. Optional daily reset (default 4 AM when enabled) and idle reset exist, plus manual `/new` and `/reset` chat commands. Cross-conversation memory is retrieval-based: `memorySearch.rememberAcrossConversations: true` adds a search step over the agent's other private conversations without merging transcripts.

### Multi-user: groups, identity, allowlists

Group access is a three-step evaluation (https://docs.openclaw.ai/channels/groups):

1. **Group policy:** `open` (any group), `disabled` (no groups), or `allowlist` (only configured groups).
2. **Group and sender allowlists:** `groupAllowFrom`, per-room user restrictions (phone numbers on WhatsApp/Signal/iMessage, numeric IDs on Telegram, guild/channel allowlists on Discord/Slack, room IDs or aliases on Matrix).
3. **Mention gating:** by default, group messages require an explicit mention (native platform mention or a configured regex like `@openclaw`); `requireMention: false` disables it per group. Implicit mentions (replies/quotes/thread membership, listed above) bypass mention gating but never bypass the allowlist checks.

For DMs, unknown senders hit a **pairing** flow by default: they receive a time-limited pairing code the operator must approve; alternatives are strict allowlist, fully open (requires an explicit `"*"` entry), or DMs disabled (https://docs.openclaw.ai/gateway/security).

There is no RBAC in the team-product sense (no roles, no per-user permission tiers beyond owner-only tools). The `gateway` (config read) and `cron` (persistent jobs) tools are owner-only, and the hardened baseline denies `gateway`, `cron`, `sessions_spawn`, and `sessions_send` from chat.

### Approvals through the channel

OpenClaw has a real human-in-the-loop approvals system, "exec approvals" (https://docs.openclaw.ai/tools/exec-approvals). When a sandboxed agent wants to run a command on a real host, policy plus allowlist plus (optionally) a human approval must all agree. Approval prompts can be forwarded to any chat channel, including plugin channels, and approved with `/approve` in chat. The prompt shows the command and arguments, the working directory, the agent ID, and the resolved executable path. Channels can seed native affordances: Matrix attaches emoji reaction shortcuts (approve once / always allow / deny) with `/approve` as a text fallback. There is also an "auto mode" that auto-approves reads while gating writes (https://openclaw.ai/blog/safer-than-yolo-auto-mode-for-exec-approvals). This is the strongest reference implementation of "approvals flow through the same channel the conversation lives in" found in this pass.

### Context the agent gets

For group messages, the agent receives structured inbound context fields: `ChatType=group`, `GroupSubject` (group name), `GroupMembers` (participant list when the platform exposes it), and `WasMentioned` (https://docs.openclaw.ai/channels/groups). Speaker identity comes from message metadata per platform. History is the session transcript itself (sessions are persistent), managed by compaction and pruning rather than a fixed window.

### Limitations, gotchas, security posture and incidents

OpenClaw's security posture is well documented and battle-tested by a genuine crisis in early 2026:

- **Exposed gateways:** multiple scanning teams (Censys, Bitsight, Hunt.io) found 30,000+ internet-exposed OpenClaw instances, many without authentication (https://www.esecurityplanet.com/threats/hundreds-of-malicious-skills-found-in-openclaws-clawhub/, https://conscia.com/blog/the-openclaw-security-crisis/). The default is loopback-only binding; the exposures came from users binding to `0.0.0.0`.
- **CVE-2026-25253:** a one-click remote-code-execution chain (CVSS 8.8) that worked even against localhost-bound instances, patched in v2026.1.29 (https://www.oasis.security/blog/openclaw-vulnerability, "ClawJacked").
- **ClawHub supply-chain poisoning:** the skill marketplace (ClawHub) accepted any skill from a GitHub account at least one week old, with no static analysis or signing. The "ClawHavoc" campaign planted 341 malicious skills (about 12% of the registry, later scans reported 800+, about 20%), mostly delivering the Atomic macOS Stealer (https://particula.tech/blog/openclaw-security-crisis-malicious-ai-agents, https://1password.com/blog/from-magic-to-malware-how-openclaws-agent-skills-become-an-attack-surface).

The project's own hardening stance is notable and readable at https://docs.openclaw.ai/gateway/security: identity first (lock down who can message the bot), scope second (tool allowlists, Docker sandboxing, per-tool workspace access none/ro/rw), model last (assume prompt injection succeeds; design for small blast radius). It ships an `openclaw security audit --deep --fix` command, requires 600/700 file permissions on config/state, documents incident response (contain, rotate, audit), and explicitly lists "prompt-injection-only" findings as non-vulnerabilities because injection is assumed. It warns that browser tool access with a logged-in profile is equivalent to operator access.

Gotcha for a team-channels feature: the default shared "main" DM session is a context-leak footgun the moment more than one human can DM the bot; the docs themselves tell multi-user setups to switch `dmScope` to `per-channel-peer`.

### Pricing/packaging

Free and open source; no hosted offering, so no pricing shapes the feature. The GitHub license field shows a non-standard entry ("NOASSERTION" via the API); the project is distributed as open source **[unverified: exact license terms]**. Users pay only for model API keys (or use subscription-based auth to Anthropic/OpenAI harnesses).

---

## Vendor 2: Hermes Agent (Nous Research)

### Identification

"Hermes" in the agents-in-messaging space is **Hermes Agent by Nous Research** (https://github.com/nousresearch/hermes-agent, docs at https://hermes-agent.nousresearch.com). It matches the study definition exactly: a self-hosted agent with a unified messaging gateway across Telegram, Discord, Slack, WhatsApp, Signal, email, and about 20 more surfaces. Other things named Hermes (the Nous Hermes model series itself, various crypto wallets and chat SDKs) are not channel products; several third-party sites (hermesagents.net, hermes-agent.ai) appear to be SEO satellites around the Nous product rather than separate products **[unverified]**. Repo stats verified via the GitHub API: about 217,500 stars, 41,000 forks, MIT license, repository created July 2025.

### What the product is and how it positions channels

Hermes Agent is "the agent that grows with you": an open-source, self-hostable agent whose signature feature is a learning loop (it writes its own skills from experience and keeps persistent memory across sessions). Channels are positioned as reach: one background gateway process (`hermes gateway`) makes the same agent reachable from every configured platform simultaneously, with the same slash commands (`/model`, `/new`, `/retry`) working across CLI and messaging surfaces (https://github.com/nousresearch/hermes-agent, https://hermes-agent.nousresearch.com/docs/user-guide/messaging/). Deployment backends include local, Docker, SSH, Modal, and Daytona. It is model-agnostic (Nous Portal, OpenRouter, OpenAI, custom endpoints).

The overall shape is strikingly similar to OpenClaw (single gateway process, per-chat sessions, DM pairing codes, allowlists); Hermes predates OpenClaw's repo by four months and the two have clearly co-evolved in public **[unverified: direction of influence]**.

### Channels supported and depth per channel

The messaging gateway supports 25+ platforms: Telegram, Discord, Slack, WhatsApp, Signal, SMS, email, Home Assistant, Mattermost, Matrix, DingTalk, Feishu/Lark, WeCom, Weixin (WeChat), BlueBubbles (iMessage), QQ, Yuanbao, Microsoft Teams, LINE, ntfy, and a browser surface (https://hermes-agent.nousresearch.com/docs/user-guide/messaging/).

The docs publish an explicit per-platform capability matrix:

- **Broadest feature set** (voice, images, files, threads, reactions, typing indicators, streaming): Discord, Slack, Matrix, Feishu/Lark.
- **Threads:** Discord, Slack, Google Chat, Matrix, Feishu, and email (email threads map to conversations).
- **Voice replies:** Telegram, Discord, Slack, Mattermost, Matrix, Feishu, WeCom, Weixin, QQ, Yuanbao. Incoming voice is transcribed; outgoing TTS is delivered (as MP3 on WhatsApp).
- **Images/files:** most platforms except SMS and Home Assistant.
- **Telegram, WhatsApp, Signal:** images/files and streaming but no reaction support.
- **Minimal:** SMS and ntfy.

### Connection UX

Per-platform, driven by CLI wizards and environment variables on the self-hosted box:

- **Slack** (https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack): `hermes slack manifest --agent-view --write` generates an app manifest; you paste it at api.slack.com/apps ("Create from manifest"), enable Socket Mode (WebSockets, so no public HTTP endpoint needed), and set `SLACK_BOT_TOKEN` (xoxb-), `SLACK_APP_TOKEN` (xapp-), and `SLACK_ALLOWED_USERS` (comma-separated member IDs). New apps use Slack's native "Agent" messaging experience. The bot must be `/invite`d to each channel; scope or event changes require reinstalling the app.
- **WhatsApp** (https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp): two paths. The default is an unofficial Baileys bridge that emulates a WhatsApp Web session: run `hermes whatsapp`, scan a QR code with the phone, credentials persist under `~/.hermes/platforms/whatsapp/session` so re-pairing is not needed after restarts. The docs are candid about ban risk and recommend a dedicated number. The official alternative is the WhatsApp Business Cloud API, which needs a Meta business account and a public webhook URL.
- **Telegram/Discord/etc.:** bot-token paste, same pattern **[unverified detail per platform]**.

Like OpenClaw, everything is a self-hosted gateway process; there is no vendor-hosted OAuth connect flow.

### Conversation model: mention-to-session mapping and cross-surface continuity

The Slack page documents the exact interaction the Agenta feature under study describes (https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack):

- In a channel, the bot responds only when @mentioned. The mention creates a session and the bot **replies in a thread attached to that message**.
- Once the bot is active in that thread, subsequent replies in the thread do **not** need a mention; the bot follows the conversation. The thread IS the session. Messages outside threads without a mention are ignored to keep busy channels quiet.
- In 1:1 DMs the bot answers every message.

Sessions are stored per chat ("per-chat session store") and persist across gateway restarts via a "delivery ledger" (https://hermes-agent.nousresearch.com/docs/user-guide/messaging/). Long sessions are auto-compressed; per-platform idle/daily auto-reset is optional; any new message interrupts in-progress work, and `/stop` halts it.

**Cross-surface continuity is a first-class feature.** Sessions have global IDs (`YYYYMMDD_HHMMSS_<hex>`; gateway sessions get an 8-char suffix, CLI sessions 6). From the CLI, `hermes --continue`/`-c` resumes the latest session and `hermes --resume <id or title>` resumes any session, including one started on a messaging platform. From a live CLI session, `/handoff <platform>` transfers the conversation to a messaging platform's home channel; the agent picks up with the same session ID and the full role-aware transcript including tool calls. From a platform, `/resume <title>` pulls a session back (https://hermes-agent.nousresearch.com/docs/user-guide/sessions, https://hermes-agent.nousresearch.com/docs/reference/cli-commands). This is the strongest cross-surface story found in this pass and directly matches the "continue the same session from other surfaces" requirement.

### Multi-user: groups, identity, allowlists, tiers

- **Default-deny:** the gateway denies all users not in an allowlist or paired via DM (https://hermes-agent.nousresearch.com/docs/user-guide/messaging/).
- **Allowlists:** per-platform environment variables listing user IDs (e.g. `SLACK_ALLOWED_USERS`).
- **DM pairing:** unknown users who message the bot receive a one-time pairing code (e.g. "XKGH5N7P", expires in one hour); an admin approves with `hermes pairing approve <platform> <code>`.
- **Admin/user tiers:** access splits into admin vs user per scope (DM vs group). Admins get all slash commands; regular users can run only explicitly enabled commands (`allow_admin_from: ["111"]`, `user_allowed_commands: [status, model]`). `/whoami` shows your tier. This is a lightweight two-tier RBAC, more than OpenClaw offers.
- **Group session isolation, per user:** on Slack, `group_sessions_per_user: true` is the default, meaning each user in a shared channel gets their OWN isolated session; two people talking to Hermes in #general maintain separate histories. This is the opposite default from OpenClaw's shared group session and works against the "whole team collaborates in one agent thread" model unless toggled off. Whether the toggle gives a true shared multi-speaker session with speaker attribution was not verified in this pass **[unverified]**.

### Approvals through the channel

Dangerous-command / `execute_code` approval prompts render as **interactive buttons** on platforms that support them (documented for Slack). Where buttons cannot be delivered (e.g. inside Slack threads where native interactivity fails), Hermes falls back to a text prompt answered with `!approve` / `!deny` (https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack). So approvals flow through the same channel as the conversation, with graceful degradation.

### Context the agent gets

Sessions carry a full role-aware transcript including tool calls (evidenced by the handoff feature transferring "tool calls and all"). Long-session compression is automatic. Per-message speaker identity and channel metadata surfaced to the agent were not verified in detail in this pass **[unverified]**; the per-user group session default reduces the need for in-session speaker attribution on Slack.

### Limitations, gotchas, security posture

- The unofficial WhatsApp bridge carries account-ban risk and can break when WhatsApp updates its protocol; the docs recommend a dedicated number and warn against bulk outbound messaging.
- Slack setup is fiddly: missing `channels:history`/`groups:history` scopes silently reduce the bot to DM-only; every scope change forces an app reinstall; slash commands do not work inside threads (the `!` prefix workaround exists for this); the Messages Tab must be enabled or DMs are impossible; classic RTM Slack apps are dead (deprecated March 2025).
- Default-deny posture (allowlist or pairing) is solid. No publicized security incident comparable to OpenClaw's was found in this pass **[unverified: absence of incidents]**. Hermes shares the same class of risk (self-hosted agent with shell access reachable from consumer messengers), and its Skills Hub ecosystem is the same supply-chain shape that burned ClawHub.
- `/background` spawns isolated agent instances for parallel work without disturbing the chat session.

### Pricing/packaging

MIT-licensed, free, self-hosted; no managed hosting found. **Nous Portal** is an optional subscription bundling 300+ models plus a hosted "Tool Gateway" (web search, image generation, TTS, cloud browser) under one price; users can instead bring their own API keys (https://github.com/nousresearch/hermes-agent). Packaging does not gate any channel feature.

---

## Cross-vendor observations relevant to Agenta's channels feature

1. Both products converge on the same architecture: one self-hosted gateway process owning all platform connections, per-chat session keys, mention gating in groups, default-deny DM pairing/allowlists, and chat-forwarded approvals. This is close to a de-facto reference design for the space.
2. They diverge on the group-session default: OpenClaw gives a group ONE shared session (team collaborates in shared context, matching Agenta's stated model); Hermes on Slack isolates a session per user per channel by default (private context per person). Both are configurable. The choice is the central product decision for a team channels feature.
3. Hermes's thread-equals-session mapping on Slack (mention opens a thread, thread replies continue the session without mentions) is exactly the interaction Agenta describes, and its global session IDs with `/resume` and `/handoff` are the best-in-class cross-surface continuity mechanism seen here.
4. OpenClaw's exec-approvals (policy + allowlist + chat approval, with native affordances like Matrix reactions and `/approve` fallback) is the most complete approvals-through-channel design seen here.
5. Neither is a team SaaS. Both are single-operator, self-hosted tools with no hosted connect UX, no org-level RBAC, no audit trail, and no multi-tenant boundary. OpenClaw says so explicitly. A hosted, multi-tenant, team-first channels feature would be differentiated on exactly the dimensions these products punt on: hosted OAuth connect flows, workspace-level identity mapping, roles, and per-member permissions.
6. The OpenClaw security crisis (30k+ exposed gateways, CVE-2026-25253 one-click RCE, ~800 malicious ClawHub skills) is the cautionary tale: consumer messengers as an agent front door plus shell-capable agents plus a skills marketplace is a large attack surface. Its post-crisis hardening playbook (identity first, scope second, assume injection, `security audit` command, owner-only control-plane tools) is worth copying.
