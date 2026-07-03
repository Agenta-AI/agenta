---
id: fix-reference-only
title: Fix the reference-only invoke bug (priority 1)
status: locked
task: invoke-service
pr: ''
recommendation: '(a). Highest value of the whole sweep: it''s a real bug with a small
  fix, it removes the inline-config-every-call footgun, and it makes ''point at a
  committed agent by id'' actually work.'
answer: Not a bug in my view; research it and align first.
answered_by: user
raised: '2026-07-01T14:09:57Z'
updated: '2026-07-01T15:02:05Z'
---



# Fix the reference-only invoke bug (priority 1)

## Context

Invoking an agent by reference (app id only) silently runs the default agent (pi_core/gpt-5.5) instead of your committed config. Root cause: the agent workflow seeds a default config into the SDK registry (engines/running/utils.py:285-287), which turns off reference hydration (resolver.py:572-577); chat/completion seed empty and work fine. Today every caller (incl the playground) must inline the full config on every call to get the right agent. Small, contained fix.

## Options

- (a) Fix now: drop the seeded params from the agent workflow so it matches chat/completion (my rec)
- (b) Defer and keep inlining the full config everywhere

## Recommendation

(a). Highest value of the whole sweep: it's a real bug with a small fix, it removes the inline-config-every-call footgun, and it makes 'point at a committed agent by id' actually work.

## Your decision

**Locked:** Not a bug in my view; research it and align first.

Confirmed NOT a production bug (you were right). Playground inlines; triggers hydrate server-side; only a direct API-bypassing reference-only call to the agent service falls back (what the lab did). Optional low-priority one-line consistency fix (seed agent registry empty like completion/chat) if we ever want direct reference calls to hydrate. No urgent change. Correcting the kit framing.

_2026-07-01T15:02:05Z_
