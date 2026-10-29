# Channels research

Date started: 2026-07-20. Status: review copy on Mahmoud's fork; not intended to merge into Agenta-AI/agenta. Competitive research.

## The feature under study

"Channels": connect an Agenta agent to a messaging surface (Slack, Discord, Telegram,
WhatsApp, Teams, email, WeChat/Feishu/DingTalk). A user @mentions the agent in a
channel, which opens a session. The whole team can talk to the agent in that thread;
every reply in the thread lands in the same session, and the same session can be
continued from any surface (the web app, another channel). Optionally, approvals
(human-in-the-loop confirmation of agent actions) flow through the same channel.

## Approach (mirrors docs/design/mcp-gateway-research/)

1. **Light pass** (done): parallel subagents surveyed 20+ vendors from their docs,
   landing pages, and code. One raw file per vendor group in `raw/`; synthesis in
   `early-findings.md`. Mahmoud's review of that document produced the decisions.
2. **Deep pass** (done): `decisions.md` records the decisions and two fact
   corrections. Five further inputs in `raw/`: `agenta-primitives.md` (codebase
   audit), `oss-gateways.md` (LangBot/matterbridge/OpenClaw/Hermes source study),
   `integration-sdks.md` (Botpress/Bot Framework/Chatwoot/Novu contract study),
   `enterprise-posture.md` (CISO requirements and deal-killing mistakes),
   `verifications.md` (fact checks), plus `brainstorm-brief.md` and
   `gpt56-brainstorm.md` (a divergent architecture brainstorm from GPT-5.6).
3. **Synthesis**: `architecture.md`, the reviewed design: primitives, inbound and
   outbound paths, identity and enterprise invariants, the bridge contract for
   third-party channels, and the build plan.

## Extraction template (what each raw file answers)

- What the product is and how it positions the channel feature.
- Channels supported, and depth per channel (threads? DMs? group chats? reactions?).
- Connection UX: how you wire agent to channel (bot install, OAuth, token paste, QR).
- Conversation model: @mention-to-session mapping, thread-to-session continuity,
  continuing one session across surfaces.
- Multi-user behavior: several humans in one thread, identity mapping (channel user
  to platform user), RBAC / allowlists / pairing of unknown users.
- Approvals and human-in-the-loop through the channel.
- Context given to the agent: speaker identity, channel metadata, history windowing.
- Limitations, gotchas, security posture and incidents.
- Pricing/packaging where it shapes the feature.
- Sources with URLs; unverifiable claims marked **[unverified]**.
