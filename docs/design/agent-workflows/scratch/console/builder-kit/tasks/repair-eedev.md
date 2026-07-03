---
id: repair-eedev
title: 'Repair EE Dev stack: commit lanes -> but pull -> fix local deploy -> rebase
  all PRs'
status: done
owner: sonnet
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-01T20:23:55Z'
updated: '2026-07-01T21:08:30Z'
---



# Repair EE Dev stack: commit lanes -> but pull -> fix local deploy -> rebase all PRs

## Context

Stop everything; commit our changes to lanes; but pull to bring big-agents current; research what changed (services/agent->services/runner rename, migrations, env vars); fix local EE Dev deployment (env edits + surgically remove migration-blocking DB triggers, NOT nuke + rebuild run.sh --ee --dev --build + keep the subscription sidecar) until /debug-local-deployment confirms create+use an agent; rebase ALL our PR branches fixing issues (put agents_md runner fix on services/runner, fold onto #5000, close #5007; fix naming), force-push, needs-review. Guardrails: BUT-LOCK + oplog snapshot, don't touch other sessions' changes, stop-and-report on danger.

## Messages

**Agent** · Jul 1, 20:23

task created.

**Agent** · Jul 1, 21:08

GREEN. but pull applied (base 45c8bdf1bf->f8765a9b89, behind=0), services/agent->services/runner rename confirmed. EE Dev stack (.env.ee.dev.local, :8280) rebuilt; migrations clean (no broken triggers existed -> no DB surgery needed); subscription sidecar re-created on services/runner + new env names (/run ok). Agent CREATE+INVOKE verified end-to-end -> 'AGENT-LIVE-OK' (local sandbox). All PRs rebased onto f8765a9b89; #5000 now carries BOTH halves (SDK + runner fix on services/runner path); #5007 CLOSED. FLAGS: (1) UI streaming 500 from migration schema drift (session_streams.tags vs flags) - batch unaffected; (2) @lexical/history EE symlink is ephemeral - needs web/ee/package.json fix; (3) feat/claude-client-tools (other session) unapplied+preserved, its owner must rebase onto services/runner; (4) subscription-sidecar SKILL stale (old env names + services/agent paths).
