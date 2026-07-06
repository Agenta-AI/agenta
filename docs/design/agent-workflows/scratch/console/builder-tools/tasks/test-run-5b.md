---
id: test-run-5b
title: 'test_run 5b: runner half (callRef dispatch, ctx injection after permission
  verdict, timeoutMs, run-kind header, overlay flip)'
status: in-review
owner: planner -> codex-xhigh + fable review
pr: https://github.com/Agenta-AI/agenta/pull/5074
design_doc: docs/design/agent-workflows/projects/build-kit-tools-cleanup/plan-5b.md
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-05T14:22:55Z'
updated: '2026-07-05T16:08:10Z'
---



# test_run 5b: runner half (callRef dispatch, ctx injection after permission verdict, timeoutMs, run-kind header, overlay flip)

## Context

Completes test_run end to end; live debug of the full self-test loop in chat (approval pause -> approve -> digest) required before PR. Runner surface believed free post-#5066; planner verifies.

## Messages

**Agent** · Jul 5, 14:22

task created.

**Agent** · Jul 5, 16:08

Draft PR #5074 (30 files, 3 commits): callRef dispatch with post-verdict ctx injection + approval-record redaction, per-spec timeout with grace at both deadlines, run-kind recursion header, overlay armed (13 ops) + flag default-on kill switch, playbook teaches test_run. Adversarially reviewed (all 8 attacks hold) and live-verified: full approval loop via the real playground resume path, recursion 400 both entries, 76s child passes / 130s fails clean, synergy with the two bug fixes confirmed. Env findings: sidecar CMD lacks extension build (recipe note rides #5073 lane), dev DB session-table schema drift.
