---
id: overlay-scope
title: 'Build-kit overlay: static 8-tool core, or conditional event pack?'
status: open
task: ''
pr: ''
recommendation: '(b) if a cheap mechanism exists, else (a). Fewer visible tools is
  itself a reliability fix: the capstone failure mode was the run wandering into tools
  it never needed.'
answer: ''
answered_by: ''
raised: '2026-07-03T13:55:57Z'
updated: '2026-07-03T13:55:57Z'
---

# Build-kit overlay: static 8-tool core, or conditional event pack?

## Context

Today overlay.py injects all 18 platform ops unconditionally. The review says the job needs 8 core tools, plus 4 event ops (discover_triggers, create_subscription, list_deliveries, remove_subscription) only when the ask is event-driven. The overlay is assembled server-side with no per-ask logic, so conditional injection needs a mechanism (builder asks for it, or the skill names the hidden ops).

## Options

- (a) static 12 (8 core + event pack always visible)
- (b) static 8, event pack added conditionally (my rec)
- (c) keep all 19

## Recommendation

(b) if a cheap mechanism exists, else (a). Fewer visible tools is itself a reliability fix: the capstone failure mode was the run wandering into tools it never needed.

## Your decision

_Awaiting your call._
