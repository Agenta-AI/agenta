# Status

## State

Design complete. Awaiting review on the draft PR. No code changed yet. Implementation follows
after Mahmoud reviews the design.

## Provenance

- Created: 2026-07-08.
- Author: Claude (design-first workflow via the plan-feature skill).
- Session: https://claude.ai/code/session_01AumZJ9xRd4XYNHThqy4rTv
- Tracking issue: https://github.com/Agenta-AI/agenta/issues/5162
- Base branch for the PR lane: `big-agents`.

## What was done

- Filed the tracking issue (#5162), reproduction-first, symptom only.
- Verified every citation in the pre-existing diagnosis against the code at the current
  workspace commit. All held.
- Found one material refinement, recorded in research.md: the frontend comment's fear that
  forwarding a bare variant re-resolves it to a HEAD revision does not apply to playground
  runs. The re-resolution path is gated on the request having no `data.parameters`
  (`resolver.py:577-582`), and every playground run sends `data.parameters`. This makes the
  frontend fix both minimal and correct, and it removes the reason the comment gave for
  dropping the variant.
- Wrote the two options, the trade-offs, and the recommendation (Option 1, the frontend fix).

## Key decisions

- **Fix in the frontend, not the service.** The frontend owns the run identity and knows the
  loaded variant. The service option is larger and ambiguous for multi-variant apps. Full
  reasoning in plan.md.
- **Gate the revision reference, not the variant.** Draft-ness keys only on the revision
  reference (`tracing.py:165`), so gating the revision on `!isDirty` preserves `is_draft`
  while the variant identity travels on every run.
- **Panel re-sync after a self-commit is optional.** Option 1 makes the run robust with or
  without a reload. Re-syncing the panel is a display improvement, decoupled from this fix.

## Citations verified (at the current workspace commit)

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py:1090-1100` — commit_revision binds the
  variant id via context_bindings.
- `sdks/python/agenta/sdk/agents/platform/op_catalog.py:156-173` — bound fields stripped from
  the model-visible schema.
- `services/runner/src/tools/direct.ts:226-236` — runner throws on a missing binding value.
- `sdks/python/agenta/sdk/agents/tracing.py:135-166` — run-context workflow assembled from
  references; `is_draft = revision is None`.
- `sdks/python/agenta/sdk/decorators/running.py:354, 376` — request references merged onto the
  tracing context.
- `web/packages/agenta-playground/src/state/execution/agentRequest.ts:355-359` — the
  all-or-nothing gate that drops references on a dirty run.
- `web/packages/agenta-playground/src/state/execution/agentRequest.ts:86-117` —
  `buildAgentReferences` builds the three families and drops non-UUID ids.
- `web/packages/agenta-playground/src/state/execution/agentRequest.ts:378-386` — app id rides
  the URL query even on a draft run.
- `sdks/python/agenta/sdk/middlewares/running/resolver.py:577-582` — hydration gate that keeps
  the bare-variant re-resolution from firing when parameters are present.

## Recorded follow-ups

- **Optional panel adoption after a self-commit.** After `commit_revision` lands, sync the
  loaded panel to the new HEAD so the version chip bumps and `isDirty` resets. Display
  accuracy only; not required for the fix.
- **Long-term: server-stamped identity in run context.** Fold the client-forwarded variant
  identity into the same server-stamped `runContext` end-state that the session keep-alive
  follow-up 5 begins for project scope. See plan.md, "Adjacent work".

## Related work

- Session keep-alive, follow-up 5:
  `docs/design/agent-workflows/projects/session-keepalive/status.md` (decision 1, follow-up 5).
  Stamps a server-verified project scope into `runContext`. Adjacent to this design; both
  enrich `runContext`. No contradiction: F5 fills project scope, this fills variant scope.
- Reproduction timelines: `turn-c6de1865-timeline.md` and `turn-8110bba2-timeline*.md` at the
  repository root (owned by Mahmoud; read-only here).
