---
id: telegram
title: Confirm whether Telegram is a real Composio integration/trigger
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T13:55:34Z'
updated: '2026-07-01T14:00:29Z'
---




# Confirm whether Telegram is a real Composio integration/trigger

## Context

On bighetzner, discover-tools returned telegram.SEND_MESSAGE (needs_auth) and discover-triggers mis-matched telegram->a slack event. User believes there is NO telegram in composio. Verify against the composio catalog / Agenta's supported integrations whether telegram is genuinely available or a false positive.

## Messages


**Agent** · Jul 1, 13:55

task created.

**Agent** · Jul 1, 14:00

Real Telegram send tool exists; no incoming trigger. find_triggers is keyword scoring (root of the Slack mis-match) — fold into discovery-quality fixes.
