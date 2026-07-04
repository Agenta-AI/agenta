---
id: external-skills-pr
title: 'Fix agenta-skills PR #1: demote 2 scripts, add create-subscription.sh + update-agent.sh,
  document schedule inputs'
status: in-review
owner: fable
pr: https://github.com/Agenta-AI/agenta-skills/pull/1
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-03T14:46:32Z'
updated: '2026-07-03T14:57:47Z'
---



# Fix agenta-skills PR #1: demote 2 scripts, add create-subscription.sh + update-agent.sh, document schedule inputs

## Context

Implements the agreed part-1 recommendations, with live testing against the lab deployment, then updates the draft PR body.

## Messages

**Agent** · Jul 3, 14:46

task created.

**Agent** · Jul 3, 14:57

Done and live-tested on the lab deployment: list-connections.sh + annotate-trace.sh demoted to scripts/extras/, create-subscription.sh added (full end-to-end: created + deleted a real Slack-event subscription), update-agent.sh added (verified commit -> new revision with config preserved), trigger-inputs.md documents the inputs_fields semantics. 3 commits pushed, PR #1 body has a Review round 2 section. Ready for Mahmoud's review.
