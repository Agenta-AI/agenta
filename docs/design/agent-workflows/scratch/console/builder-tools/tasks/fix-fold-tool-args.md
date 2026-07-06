---
id: fix-fold-tool-args
title: 'Fix: batch transcript records partial streamed tool-call args instead of final'
status: done
owner: fable
pr: https://github.com/Agenta-AI/agenta/pull/5072
design_doc: ''
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-05T14:23:15Z'
updated: '2026-07-06T13:10:35Z'
---




# Fix: batch transcript records partial streamed tool-call args instead of final

## Context

Failing-test-first in the #5064 fold path; lane fix/invoke-fold-tool-args; draft PR to big-agents.

## Messages

**Agent** · Jul 5, 14:23

task created.

**Agent** · Jul 5, 15:05

Done. Root cause was two-layered: the runner's tool_call_update input refresh fired once-and-only-if-empty (so a partial streamed arg-delta suppressed the final-args refresh), and the SDK batch fold appended a duplicate tool message per repeat tool_call instead of refreshing in place. Failing tests first (2 runner vitest scenarios + 3 SDK fold tests), then the fix; all suites green (runner 551, SDK 1600, services agent 78). Live before/after on :8280 verified (before {"command": ""}, after the full command). Draft PR #5072 to big-agents, coderabbit triggered.

**Agent** · Jul 5, 16:08

PR up: two-layer fix (runner event refresh + SDK fold merge-by-id), failing-first tests, live verified.

**Agent** · Jul 6, 13:10

MERGED (#5072, f0b0c13) after verifying Mahmoud's two conditions (harness-generic, live-tested).
