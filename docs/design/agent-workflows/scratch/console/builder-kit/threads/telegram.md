---
id: telegram
code: TEL-7
title: 'Telegram: is there really no integration/trigger in Composio?'
status: resolved
needs_reply: false
promoted_to: ''
created: '2026-07-01T13:54:47Z'
updated: '2026-07-01T16:59:45Z'
hidden: true
---








# Telegram: is there really no integration/trigger in Composio?

## Summary

Half right. Real Telegram SEND tool exists in Composio (needs_auth = genuine, just not connected; no integration allowlist, all passthrough). But NO Telegram incoming-message trigger here, so a listen+reply bot is not buildable; one-way send would be once connected. Separately: find_triggers is keyword scoring, not semantic — why 'telegram' matched a Slack event. Findings: findings/telegram.md

## Messages


**Agent** · Jul 1, 13:54

User: for telegram there is no telegram integration/trigger in composio. Spin a subagent to check.

**Agent** · Jul 1, 14:00

Half right. There IS a real Telegram integration in Composio for sending: telegram.SEND_MESSAGE is a genuine slug returned by Composio semantic search (adapter.py:211-284), and Agenta has NO integration allowlist — every integration is a live passthrough to Composio V3, so availability = whatever Composio returns. The needs_auth state was meaningful (real integration, OAuth, just not connected), not a phantom. BUT there is no Telegram incoming-message trigger on this deployment: Composio returned no telegram trigger event (corroborated by the manual test api/oss/tests/manual/triggers/try_composio_triggers.py, which notes Composio only exposes Slack messages-received). So a Telegram BOT (listen + reply) is NOT buildable here; a one-way send-to-Telegram agent would be, once Telegram is connected. Bonus finding worth acting on: find_triggers is KEYWORD scoring over the live catalog (service.py:330/463/170), not semantic search — "new telegram message" matched Slack SLACK_CHANNEL_MESSAGE_RECEIVED on the word "message", and candidate loaders even fall back to unfiltered catalog pages. A 2-term evidence guard exists (line 183) but the fall-through is the root of noisy matches. That is the same "discovery is approximate" issue and is fixable.
