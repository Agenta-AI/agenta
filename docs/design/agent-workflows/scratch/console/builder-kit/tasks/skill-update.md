---
id: skill-update
title: Update build-agent skill with advisor improvements + streaming test-agent.sh
status: in-review
owner: sonnet
pr: https://github.com/Agenta-AI/agenta-skills/pull/1
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-01T17:57:52Z'
updated: '2026-07-01T18:02:06Z'
---



# Update build-agent skill with advisor improvements + streaming test-agent.sh

## Context

Apply advisor's 8: port the streaming test-agent.sh (shipped one is stale/batch), promote numbered-procedure rule inline, add discovery-is-a-search, reframe persona to authoring, keep load-bearing inline, invoke-path provisional, keep failed-build/archive. Update agenta-skills#1 (normal git, no worktree).

## Messages

**Agent** · Jul 1, 17:57

task created.

**Agent** · Jul 1, 18:02

Done, agenta-skills#1 updated (commit ceed5c2, draft). SKILL.md: Verify rewritten to streaming (TOOLS line primary, check-tools fallback); numbered-procedure rule promoted inline; discovery-is-a-search restored; persona reframed to authoring; invoke-path flagged provisional. Streaming test-agent.sh ported into the skill. bash -n clean on all 13 scripts. Not live-tested (no creds in that env; near-verbatim copy of the kit's working version).
