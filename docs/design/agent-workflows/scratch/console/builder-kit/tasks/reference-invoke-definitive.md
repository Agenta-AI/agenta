---
id: reference-invoke-definitive
title: 'Settle definitively: does invoke-by-reference load the committed config? (live
  proof)'
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T15:37:41Z'
updated: '2026-07-01T15:44:34Z'
---



# Settle definitively: does invoke-by-reference load the committed config? (live proof)

## Context

Two live attempts (references-only; references+data.revision) both ran the default gpt-5.5 and 500'd. Find the exact payload that runs the committed config by reference, or prove only inline works, and whether the product path loads it. Retract-and-verify.

## Messages

**Agent** · Jul 1, 15:37

task created.

**Agent** · Jul 1, 15:44

SETTLED live. Working shape = double-nested data.revision={data:<revision.data>} -> committed config (RESOLVED claude/sonnet, 200). My attempt 2 failed because single-nested; resolver reads data.revision[data] (resolver.py:150). Product path (playground/triggers/HITL) pre-hydrates via _ensure_request_revision = NOT a bug. Raw references-only service call = real gap, service does not self-hydrate a bare ref. Findings: reference-invoke-definitive.md.
