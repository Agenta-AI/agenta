---
id: internal-plan
title: 'plan-feature: build-kit-tools-cleanup design workspace + docs-only draft PR'
status: in-review
owner: fable
pr: https://github.com/Agenta-AI/agenta/pull/5060
design_doc: docs/design/agent-workflows/projects/build-kit-tools-cleanup/README.md
blocked_on: ''
needs_reply: false
hidden: false
created: '2026-07-03T14:46:39Z'
updated: '2026-07-03T15:49:32Z'
---



# plan-feature: build-kit-tools-cleanup design workspace + docs-only draft PR

## Context

Researches the executor architecture for the logic-bearing-tools question (Mahmoud rejected the composite-endpoint framing; evaluating ctx-injection for gateway tools, runner-side composites, new executor kind, composite endpoint), plus renames/cuts surface, test_run contract, skills port. PR via GitButler lane after Mahmoud reviews.

## Messages

**Agent** · Jul 3, 14:46

task created.

**Agent** · Jul 3, 15:49

Design workspace complete (8 docs) and landed as draft PR #5060 (docs-only, base big-agents, lane docs/build-kit-tools-cleanup). Recommendation: Option C, a PlatformOp handler mode on the existing tool-call plane (callRef), keeping the resource API atomic. Notable finding: three of the four authoring skills appear never delivered by the overlay (attach bug suspected). Two files (context.md, research.md) temporarily ride in #5041 pending a hand-off. Ready for Mahmoud.
