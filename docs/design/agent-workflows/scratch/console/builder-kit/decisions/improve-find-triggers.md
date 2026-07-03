---
id: improve-find-triggers
title: Tighten find_triggers matching (lower priority)
status: locked
task: telegram
pr: ''
recommendation: (b) for now. The per-capability integration/state is reliable; only
  the matched trigger action is noisy, and the agent can catch it. Revisit if trigger
  use cases become central.
answer: Add it to the instructions; discovery is a search, keep high recall but verify
  precision.
answered_by: user
raised: '2026-07-01T14:09:57Z'
updated: '2026-07-01T14:47:54Z'
---



# Tighten find_triggers matching (lower priority)

## Context

find_triggers is keyword scoring over Composio's live catalog, not semantic search (core/triggers/service.py:330/463/170). 'new telegram message' matched Slack's SLACK_CHANNEL_MESSAGE_RECEIVED on the word 'message', and candidate loaders fall back to unfiltered catalog pages. A 2-term evidence guard exists but the fall-through produces noisy cross-integration matches. Tool discovery (find_capabilities) is more reliable; this is specifically the trigger path.

## Options

- (a) Tighten now: require primary-integration evidence and drop the unfiltered fallback
- (b) Defer: keep it, and have the agent sanity-check the matched event's integration (the kit already teaches checking connection state)

## Recommendation

(b) for now. The per-capability integration/state is reliable; only the matched trigger action is noisy, and the agent can catch it. Revisit if trigger use cases become central.

## Your decision

**Locked:** Add it to the instructions; discovery is a search, keep high recall but verify precision.

Added a 'discovery is a search, not an oracle' rule to BUILD-AGENT.md: matched integration + connection-state are reliable, matched action is not; always verify the action before wiring, re-word or use alternatives if off. No backend change.

_2026-07-01T14:47:54Z_
