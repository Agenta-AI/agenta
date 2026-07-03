---
id: agentsmd-split
title: Split the agents_md fix
status: done
owner: orchestrator
pr: ''
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-01T18:23:39Z'
updated: '2026-07-01T21:08:30Z'
---




# Split the agents_md fix

## Context

Split the agents_md fix: SDK half stays on #5000, runner half goes on a new runner-branch PR based on 45c8bdf1bf.

## Messages

**Agent** · Jul 1, 18:23

task created.

**Agent** · Jul 1, 18:34

Split subagent RUNNING (a5b18e905). SDK half (interfaces.py + test) -> PR #5000 (flip to implementing); runner half (workspace.ts + test, the live fix) -> a new runner-branch PR based on 45c8bdf1bf. Code recovered+verified earlier (402 runner + 454 SDK tests pass).

**Agent** · Jul 1, 18:41

DONE. SDK half -> #5000 (interfaces.py + test, label lgtm+implementing, 454 SDK tests pass). Runner half (the LIVE fix, workspace.ts) -> NEW PR #5007 (base fix/infinite-loop-in-big-agents, needs-review, runner test 10/10, no new tsc/prettier). Both draft, cross-linked. Baseline has 2 pre-existing unrelated runner failures (noise, not from this fix).

**Agent** · Jul 1, 21:08

Superseded by the repair rebase: both halves folded onto #5000 (services/runner path); #5007 closed.
