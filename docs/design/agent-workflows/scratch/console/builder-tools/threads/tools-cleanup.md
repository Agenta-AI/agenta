---
id: tools-cleanup
code: CLE-1
title: Clean up + standardize builder tools (inside Agenta vs build-agent skill)
status: waiting
needs_reply: false
promoted_to: ''
hidden: false
created: '2026-07-03T13:53:52Z'
updated: '2026-07-03T15:49:41Z'
---






# Clean up + standardize builder tools (inside Agenta vs build-agent skill)

## Summary

**Both deliverables are in review.** External: agenta-skills PR #1 updated and live-tested (extras demotion, create-subscription.sh, update-agent.sh, trigger-inputs docs). Internal: design draft PR [#5060](https://github.com/Agenta-AI/agenta/pull/5060) with the build-kit-tools-cleanup workspace; recommendation = Option C (PlatformOp handler mode on the tool-call plane) for logic-bearing tools like test_run; finding = 3 of 4 authoring skills likely never delivered by the overlay. Waiting on Mahmoud: review both PRs + re-answer the three lost decisions (overlay-scope, test-run-shape, spans-stopgap).

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
