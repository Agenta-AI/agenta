# Status

## Current phase

Planning complete; implementation has not started. The design is prepared as a child of
#6365. Neither the secret-handling prompt text nor runtime behavior changes in this PR.

## Decisions

- The user approved two milestones: internal readable delivery first, host-restricted
  policy second.
- Milestone one includes explicit bindings, backend resolution, runner injection, a shared
  select/create/attach flow, and an agent request card with correct save/resume behavior.
- The child implementation includes guidance in #6365's shared platform module.
- Text-only bindings, variable validation, redaction, failure handling, and conversation
  continuity remain requirements of milestone one.
- The simplification pass keeps ordinary agent revisions and the existing client-tool and
  run lifecycle. It adds no apply endpoint, readiness polling, setup service, or new tables.

## Review decisions

The plan recommends persistent agent-variant bindings, permission to edit secrets as a
requirement for attaching readable credentials, and a controlled reopen/rebuild when
needed. Review those tradeoffs together with the card completion flow. The high-level
milestone split and shared-guidance dependency are already agreed.

## Evidence and validation

Research inspected `origin/main` at `770b566e5e0e280c95088a591315da9c0af19375`, current GitHub issue/PR records, and #6365
head `ecb28ea14b3664f64da010948b8bf621db0fa0b9`. Runtime and UI paths were read, not
executed. See research.md for the remaining implementation checks and qa.md for exit gates.

Publication checks cover relative documentation links, whitespace, style, and the exact
child diff. Runtime tests do not apply to this documentation-only change.

## Workspace handoff

The local parent contains an older design revision than the remote #6365 implementation.
GitButler's remote-update dry run failed while merging workspace bases. GitButler writes
were frozen; no workspace repair is part of this task. Publish through the recovery
runbook's temporary-index path with the remote #6365 head as the exact parent. Do not
push or rewrite the parent PR. The published child branch is not an applied local lane.

## Next work

Review the design PR. After approval, implement milestone one in the order in plan.md.
Update #5703's milestone wording when implementation tracking is reorganized; do not mark
the issue complete on the strength of this plan. Milestone two needs its own detailed
policy contract after the readable flow is working.
