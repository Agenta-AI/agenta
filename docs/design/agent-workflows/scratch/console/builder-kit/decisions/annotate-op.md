---
id: annotate-op
title: Add the annotate_trace platform-op (unblocks case 3)
status: locked
task: annotation
pr: ''
recommendation: (a) if you want case 3 buildable; it's genuinely small because the
  plumbing exists. Priority 3 — after the reference-only and invoke-hardening fixes.
answer: greenlit
answered_by: user
raised: '2026-07-01T14:09:57Z'
updated: '2026-07-01T14:59:32Z'
---




# Add the annotate_trace platform-op (unblocks case 3)

## Context

The self-reflecting agent (case 3) needs an agent-callable way to annotate its own trace. None exists in PLATFORM_OPS. But the run-context plumbing is already there and unused: RunContextTrace carries the run's own trace_id/span_id, and its docstring literally reserves $ctx.trace.trace_id 'for annotate my trace'. One PlatformOp closes it: op=annotate_trace wrapping POST /api/annotations/, model supplies evaluator.slug + data.outputs, runner binds the trace/span from context so the agent can only annotate its own run.

## Options

- (a) Add the op now (small, self-targeted like commit_revision). My rec, but lower priority than the two invoke fixes.
- (b) Defer until case 3 is actually needed

## Recommendation

(a) if you want case 3 buildable; it's genuinely small because the plumbing exists. Priority 3 — after the reference-only and invoke-hardening fixes.

## Your decision

**Locked:** greenlit

Draft PR #4999 up (annotate_trace op, base big-agents). Review subagent dispatched; you review the draft PR after. Design doc in projects/builder-agent-reliability/annotate-op/.

_2026-07-01T14:59:32Z_
