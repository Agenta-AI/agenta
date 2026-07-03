---
id: annotate-op-impl
title: Implement annotate_trace platform-op (plan -> code -> review -> draft PR)
status: in-review
owner: sonnet
pr: https://github.com/Agenta-AI/agenta/pull/4999
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T14:48:39Z'
updated: '2026-07-01T18:26:00Z'
---










# Implement annotate_trace platform-op (plan -> code -> review -> draft PR)

## Context

Add annotate_trace to PLATFORM_OPS mirroring commit_revision, wrapping POST /api/annotations/, self-targeted from $ctx.trace. Use plan-feature, then review, then a draft PR with docs. Findings sketch in scratch/console/builder-kit/findings/annotation.md.

## Messages

**Agent** · Jul 1, 14:48

task created.

**Agent** · Jul 1, 14:59

Implemented + draft PR #4999 (base big-agents, 3 files, 266 ins). annotate_trace mirrors commit_revision; self-targeted via context_bindings on $ctx.trace.trace_id/span_id; schema exposes only evaluator.slug + data.outputs; allow/no-approval. ruff clean, 87+4 tests pass. Now dispatching a review pass.

**Agent** · Jul 1, 15:11

Review found a proven self-targeting bypass (sibling-link smuggling). PR #4999 needs changes before it's mergeable. Fix approach is a decision (annotate-selftarget-fix).

**Agent** · Jul 1, 15:37

Self-target fix in progress (documented PR update, not gated). Closing the smuggled-sibling hole + test + ask default + docs.

**Agent** · Jul 1, 15:43

Corrected to design-first. Killed the premature self-target fix. A plan-feature DESIGN pass is now running: resolve where the evaluator comes from (is there a default project evaluator? its schema? can it hold reflection data?), make self-targeting airtight, and put the design doc on draft PR #4999. NO implementation until you approve the design on the PR.

**Agent** · Jul 1, 15:55

DESIGN DOC on PR #4999 (commit 2f12208f93, GitButler lane, no code touched, draft). Evaluator resolved: projects DO seed a default feedback evaluator (quality-rating) but its schema is rigid {approved:boolean} so it can't hold freeform reflection. Recommended: a reserved 'agent self-reflection' evaluator with a permissive schema, bound server-side (model never names it; supplies only data.outputs). Current PR is wrong (model-invented slug -> evaluator sprawl + genson makes first-write keys required -> 2nd write 422s). Self-target: runner does NOT validate args vs input_schema (relay.ts:211), so server must REPLACE whole links AND references subtrees. Awaiting user feedback on the PR; no impl until approved.

**Agent** · Jul 1, 16:14

Code stripped: PR #4999 is now design-doc-only + needs-review label. Being expanded from a single README into a full plan-feature workspace (context/research/plan/status/README). No implementation until you approve the design on the PR.

**Agent** · Jul 1, 18:04

SECOND ROUND (your #4999 review). Decisions: structured reflection evaluator schema (reflection string + binary score/judgment + meta object, renders in UI); seed by default on project creation + a backfill migration like quality-rating (not ensure-exists-at-annotation-time); skill gets a fallback resource to create the evaluator if missing; rewrite the self-target section plainly (invariant = annotate only your own trace; fix = runner primitive clears the whole links subtree before refilling the bound leaves). Design-docs-only on #4999.
