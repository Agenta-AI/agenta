# Status

## State

Implemented. The design was reviewed and approved (Option 1). The frontend fix landed on the
same PR lane. Unit tests are green. One follow-up test is deferred.

## What was done

- Filed the tracking issue (#5162), reproduction-first, symptom only.
- Verified every citation in the pre-existing diagnosis against the code. Most held. One was
  wrong and is corrected in research.md (see "Corrections after verification" below).
- Wrote the two options, the trade-offs, and the recommendation (Option 1, the frontend fix).
- Implemented Option 1 in `web/packages/agenta-playground/src/state/execution/agentRequest.ts`.
  The all-or-nothing gate is now a field-level gate: `application` and `application_variant`
  forward whenever they exist; `application_revision` forwards only on a clean run. An empty
  gated result still falls back to `null`. The stale code comment was replaced.

## Corrections after verification

Two claims in the first draft of research.md were wrong. Both are fixed in the current
research.md.

- **What `isDirty` compares.** The first draft said the dirty check compares the loaded panel
  against the variant's current HEAD, so a self-commit that moves the HEAD flips `isDirty` to
  true. That is not what the code does. `isDirty` compares the loaded revision's draft overlay
  against that same revision's own immutable server snapshot
  (`web/packages/agenta-entities/src/workflow/state/store.ts:1897-1934`). There is no HEAD
  comparison. "Dirty" means the loaded revision carries a draft overlay, for any reason.
- **Panel re-sync after a self-commit already exists.** The reviewer suspected a stale-page
  problem after a commit. It was real historically and is already handled by issue #4920: the
  backend emits a `data-committed-revision` event and the chat panel calls `switchEntity` to
  repoint onto the new revision id, which has no overlay. The residual risk is that the event
  can be missed or the stream aborted, leaving the old revision loaded. That residual is one
  more reason the run must carry the variant on every call, which is what this fix does.

## Key decisions

- **Fix in the frontend, not the service.** The frontend owns the run identity and knows the
  loaded variant. The service option is larger and ambiguous for multi-variant apps. Full
  reasoning in plan.md.
- **Gate the revision reference, not the variant or app.** Draft-ness keys only on the
  revision reference (`tracing.py:165`), so gating the revision on `!isDirty` preserves
  `is_draft` while the variant and app identities travel on every run.

## Implementation

- Code commit: `95d964f2de` (`fix(frontend): forward variant references on draft playground
  runs`).
- Changed file: `web/packages/agenta-playground/src/state/execution/agentRequest.ts` (the
  reference gate and its comment).
- Tests: `web/packages/agenta-playground/tests/unit/agentRequest.test.ts`.
  - Dirty, committed revision: `references` carries `application` and `application_variant`,
    omits `application_revision`.
  - Truly-uncommitted local draft (non-UUID ids everywhere): `references` is null, unchanged.
  - Mixed case: a local draft revision id under a committed variant still forwards
    `application` and `application_variant`.
  - Invariant guard: a dirty committed run still carries `data.parameters`, so the backend
    hydration gate never fires.
- Results: 31/31 in the file, 196/196 in the package. `pnpm lint-fix` clean.

## Deferred follow-ups

- **Integration or replay test for the self-commit loop.** Turn the reported failure into a
  replay regression test (see the `agent-replay-test` skill): the first `commit_revision`
  succeeds, a second in the same conversation succeeds, and the second run still reports
  `is_draft` true. Deferred as a follow-up; the unit tests cover the gate itself.
- **Stream-event race on panel repointing.** The #4920 repointing depends on the
  `data-committed-revision` event arriving and being processed. If the stream is aborted or
  the event is missed, the panel stays on the old revision and reads as dirty. This fix makes
  the run correct in that case, but the display can still lag until a reload. Tightening the
  repointing is display accuracy only, not correctness.
- **Long-term: server-stamped identity in run context.** Fold the client-forwarded variant
  identity into the same server-stamped `runContext` end-state that the session keep-alive
  follow-up 5 begins for project scope. See plan.md, "Adjacent work".

## Citations verified

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py:1090-1100`: commit_revision binds the
  variant id via context_bindings.
- `sdks/python/agenta/sdk/agents/platform/op_catalog.py:156-173`: bound fields stripped from
  the model-visible schema.
- `services/runner/src/tools/direct.ts:226-236`: runner throws on a missing binding value.
- `sdks/python/agenta/sdk/agents/tracing.py:135-166`: run-context workflow assembled from
  references; `is_draft = revision is None`.
- `sdks/python/agenta/sdk/decorators/running.py:354, 376`: request references merged onto the
  tracing context.
- `web/packages/agenta-playground/src/state/execution/agentRequest.ts`: the reference gate
  (now field-level).
- `web/packages/agenta-entities/src/workflow/state/store.ts:1897-1934, 2011-2034`: the
  `isDirty` comparator: draft overlay versus the same revision's own snapshot.
- `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:242-249, 729-756`: the
  `data-committed-revision` event derived from the commit_revision output.
- `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:851-873`: the panel reacts and
  repoints via `switchEntity`.
- `sdks/python/agenta/sdk/middlewares/running/resolver.py:577-582`: hydration gate that keeps
  the bare-variant re-resolution from firing when parameters are present.

## Provenance

- Design created: 2026-07-08. Implementation: 2026-07-09.
- Author: Claude (design-first workflow via the plan-feature skill; implementation and
  doc-correction pass).
- Design session: https://claude.ai/code/session_01AumZJ9xRd4XYNHThqy4rTv
- Tracking issue: https://github.com/Agenta-AI/agenta/issues/5162
- Base branch for the PR lane: `big-agents`.

## Related work

- Session keep-alive, follow-up 5:
  `docs/design/agent-workflows/projects/session-keepalive/status.md` (decision 1, follow-up 5).
  Stamps a server-verified project scope into `runContext`. Adjacent to this design; both
  enrich `runContext`. No contradiction: F5 fills project scope, this fills variant scope.
- Reproduction timelines: `turn-c6de1865-timeline.md` and `turn-8110bba2-timeline*.md` at the
  repository root (owned by Mahmoud; read-only here).
