---
id: research-telegram-integration
title: Research how to add Telegram integrations in Agenta
kind: task
status: open
source_project: builder-kit
source_thread: telegram
created: '2026-07-01T14:16:16Z'
updated: '2026-07-01T14:16:16Z'
---


# Research how to add Telegram integrations in Agenta

## Notes

Half right. Real Telegram SEND tool exists in Composio (needs_auth = genuine, just not connected; no integration allowlist, all passthrough). But NO Telegram incoming-message trigger here, so a listen+reply bot is not buildable; one-way send would be once connected. Separately: find_triggers is keyword scoring, not semantic — why 'telegram' matched a Slack event. Findings: findings/telegram.md

**You** · Jul 1, 14:16

Scope: incoming-message trigger (bot listen+reply) is the gap; one-way send already works via Composio once connected. Also fix find_triggers keyword-vs-semantic matching. Findings: builder-kit/findings/telegram.md

## Links

- [builder-kit · thread telegram](/p/builder-kit#thread-telegram)
