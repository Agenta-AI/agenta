---
id: tools-cleanup
code: CLE-1
title: Clean up + standardize builder tools (inside Agenta vs build-agent skill)
status: resolved
needs_reply: false
promoted_to: ''
hidden: false
created: '2026-07-03T13:53:52Z'
updated: '2026-07-06T13:10:40Z'
---











# Clean up + standardize builder tools (inside Agenta vs build-agent skill)

## Summary

**Arc complete. Merged: #5060, #5068 (build-kit cleanup), #5074 (test_run end to end), #5072 (transcript args). Superseded: #5073 code (by JP's #5081); its remainder is a docs-only recipe PR awaiting a yes/no. Local tracing restored** (dead pre-#5061 workers + DB drift fixed, stack recreated, workers ingesting).

## Messages

**Agent** · Jul 3, 13:53

Kicked off 2026-07-03. First deliverable is a review doc, no code changes yet.

**You** · Jul 3, 14:22

ok thank you for looking into this. can you please spin off a subagent to break this into part 1 about external tools and recommendations and part 2 about internal tools. Also, for missing internla tools that are not platform tools since they include logic, we can have them as gateway tools no?

**Agent** · Jul 3, 14:25

Split in progress via subagent. On your gateway question: gateway tools route to external provider actions through the connections system and cannot carry the $ctx self-targeting bindings that keep platform ops safe, so test_run stays a platform op wrapping one new /api endpoint (full section added to part 2). Note: your answers to overlay-scope, test-run-shape and spans-stopgap did not survive on disk (concurrent-session restore loop); only op-renames landed. Please re-answer those three.

**Agent** · Jul 3, 14:46

All [[comments]] folded into part 1 and part 2. External PR fix and the internal plan-feature workspace are both running; the plan lands as a docs-only draft PR for your review.

**Agent** · Jul 3, 15:49

Draft PR #5060 is up (docs-only). Review focus: tool-home-options.md (Option C), plan.md slice ordering vs the approval-boundary lane, and the three open decisions in status.md. The external PR #1 in agenta-skills is also ready.

**Agent** · Jul 4, 17:50

Implementation kicked off 2026-07-04 after Mahmoud's go-ahead. Deliverable: one draft PR to big-agents with inline review-guide comments.

**Agent** · Jul 4, 21:28

PR #5068 is ready for review with inline review guides. The three assumed decisions (static-13 overlay, sync+delta test_run, query_spans now) are flagged in the body. The resolver seed fix is in the working tree but needs #5002 merged (or a restack) before it can commit; a correction comment on the PR marks it.

**Agent** · Jul 5, 14:07

Merged. Remaining follow-ups live in scratch/open-issues.md: slice 5b (runner callRef dispatch + overlay flip + flag default-on) and the gateway->server label rename. Two observations parked: sidecar sessions-persist 401s, transcript tool-call arg fidelity.

**Agent** · Jul 5, 16:08

All three PRs are up with review guides and CodeRabbit triggered. 5b was adversarially reviewed (injection confinement and the recursion loop traced in code) before the live matrix.

**Agent** · Jul 6, 13:10

Everything from the session is merged or awaiting one small yes/no (#5073 docs-only). Local stack is healthy: consolidated workers live, tracing verified end to end, sub-sidecar reconnected.
