---
id: test-run-shape
title: 'test_run op: sync with duration cap, and does it accept a delta?'
status: open
task: ''
pr: ''
recommendation: '(a): start synchronous with a server-side cap and support delta;
  split into a poll pair later only if real runs exceed the cap.'
answer: ''
answered_by: ''
raised: '2026-07-03T13:56:04Z'
updated: '2026-07-03T13:56:04Z'
---

# test_run op: sync with duration cap, and does it accept a delta?

## Context

test_run needs one new composite endpoint (POST /api/workflows/test): hydrate committed revision, invoke headless server-side, digest stream + spans into {output, ordered tools, approvals, resolved config, verdict}. Two shape calls: sync (one op, duration cap, lab runs finished well under a minute) vs async (test_id + poll op pair, second op + more turns). And: accept an optional delta to test uncommitted changes (matches the lab try-then-commit loop, but widens the endpoint) or committed-revision only.

## Options

- (a) sync + delta (my rec)
- (b) sync, committed-only
- (c) async pair from the start

## Recommendation

(a): start synchronous with a server-side cap and support delta; split into a poll pair later only if real runs exceed the cap.

## Your decision

_Awaiting your call._
