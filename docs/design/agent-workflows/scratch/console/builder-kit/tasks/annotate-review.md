---
id: annotate-review
title: 'Adversarial review of annotate_trace PR #4999'
status: done
owner: sonnet
pr: https://github.com/Agenta-AI/agenta/pull/4999
design_doc: ''
blocked_on: ''
needs_reply: false
created: '2026-07-01T15:00:14Z'
updated: '2026-07-01T15:11:38Z'
---



# Adversarial review of annotate_trace PR #4999

## Context

Review self-targeting can't be bypassed, $ctx.trace tokens resolve, the annotation body is accepted live, and the tests are meaningful. Posts a review comment on #4999.

## Messages

**Agent** · Jul 1, 15:00

task created.

**Agent** · Jul 1, 15:11

Found + PROVED live a MEDIUM self-targeting hole: binding owns only links.invocation.{trace_id,span_id} but links is a map; runner doesn't clear siblings, so a smuggled links.x:{trace_id:other} retargets. Posted PR comment. Tokens resolve OK; live POST 200 + linked; tests meaningful but the hole is untested. Verdict: NEEDS CHANGES.
