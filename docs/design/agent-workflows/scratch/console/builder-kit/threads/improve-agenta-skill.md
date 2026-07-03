---
id: improve-agenta-skill
code: IMP-10
title: Improve the build-agent skill from yesterday's experiments (advisor chat)
status: waiting
needs_reply: false
promoted_to: ''
hidden: false
created: '2026-07-01T17:50:27Z'
updated: '2026-07-01T18:23:49Z'
---




# Improve the build-agent skill from yesterday's experiments (advisor chat)

## Summary

**Advisor on standby.** Briefing delivered and folded into the skill: streaming test-agent.sh ported, key sections promoted inline, Verify now streaming-first.

## Messages

**Agent** · Jul 1, 17:50

Advisor briefing delivered. User can chat with the advisor (relayed).

**Agent** · Jul 1, 17:57

Applying the advisor's improvements to the shipped skill now (subagent): port the streaming test-agent.sh (fixes the stale-batch gap), promote the numbered-procedure rule inline, add discovery-is-a-search, reframe persona to authoring, keep the load-bearing rules inline. Updating agenta-skills#1.

**Agent** · Jul 1, 18:02

Applied and pushed to agenta-skills#1 (commit ceed5c2, still draft). The stale-batch gap is closed: streaming test-agent.sh is now in the skill, Verify uses the TOOLS line as the primary signal, and the numbered-procedure rule, discovery-is-a-search, and persona-authoring guidance are inline in SKILL.md. Review on agenta-skills#1. The advisor stays available for deeper questions.
