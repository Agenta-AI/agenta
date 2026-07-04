---
id: spans-stopgap
title: Ship query_spans stopgap read op now, or hold for test_run?
status: open
task: ''
pr: ''
recommendation: '(a): cheap, read-only, immediately closes the verify gap for scheduled
  runs; test_run replaces the interactive half later.'
answer: ''
answered_by: ''
raised: '2026-07-03T13:56:17Z'
updated: '2026-07-03T13:56:17Z'
---

# Ship query_spans stopgap read op now, or hold for test_run?

## Context

A read op over POST /api/spans/query is a pure data add to op_catalog.py (no new endpoint). It gives the inside agent span-level verification of past runs and schedule fires today (what check-tools.sh does outside). test_run supersedes most of it later but needs a new endpoint first.

## Options

- (a) ship stopgap now (my rec)
- (b) hold for test_run

## Recommendation

(a): cheap, read-only, immediately closes the verify gap for scheduled runs; test_run replaces the interactive half later.

## Your decision

_Awaiting your call._
