---
id: implement-cleanup
title: 'Implement build-kit-tools-cleanup (6 slices, one PR): renames, overlay cuts,
  query_spans, skills port, test_run handler mode, rename-or-defer'
status: done
owner: codex-xhigh + fable review
pr: https://github.com/Agenta-AI/agenta/pull/5068
design_doc: docs/design/agent-workflows/projects/build-kit-tools-cleanup/plan.md
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-04T17:50:22Z'
updated: '2026-07-05T14:07:51Z'
---





# Implement build-kit-tools-cleanup (6 slices, one PR): renames, overlay cuts, query_spans, skills port, test_run handler mode, rename-or-defer

## Context

Mahmoud approved Option C (2026-07-04) and asked for implementation: Codex xhigh writes, Fable reviews, GitButler lane, tested vs local deployment, single draft PR with inline review-guide comments. Three decisions proceed on recommendations and are flagged in the PR: static-13 overlay, test_run sync+delta, query_spans now.

## Messages

**Agent** · Jul 4, 17:50

task created.

**Agent** · Jul 4, 19:41

Slices 1-4 committed+pushed. 5a in progress, 5b blocked on runner surface, 6 deferred. Next: 5a review, e2e debug loop, test matrix, docs sync, PR.

**Agent** · Jul 4, 21:28

Draft PR #5068 up (stacked on the docs lane): slices 1-5a all committed, live-verified end to end, 7 inline review-guide comments, CodeRabbit triggered. One exclusion: the 4-file resolver seed fix cannot commit while #5002's lane holds the same resolver region (hand-off filed; unblock = merge #5002 or restack). 5b (runner half) and the gateway rename are filed as defer-todos.

**Agent** · Jul 5, 14:07

MERGED to big-agents (1756d3d838): #5060 (design) + #5068 (implementation, 40 files). Final round: CodeRabbit 5 fixes incl. SSRF delta confinement, org pass, seed fix, builtin-grants fix from live QA (custom tools strip Pi read -> skills unloadable), test pin. Deferred: 5b runner half (open-issues), gateway rename. test_run flag-gated OFF until 5b.
