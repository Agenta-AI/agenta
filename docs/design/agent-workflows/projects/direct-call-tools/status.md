# Status

Last updated: 2026-06-27

## Where this is

DESIGN deliverable, complete: context, research, design, plan. A draft PR carries these docs for
Mahmoud's review. No code in this project. Implementation is dispatched by the orchestrator to a
subagent once the design is approved; it is not done here.

`design.md` (the `call` descriptor, the per-tool-type table, the dispatch algorithm) and
`plan.md` (the phases) are the spec the implementation subagent would follow. Phase 1's wire
field lands on `CallbackToolSpec` in the shared `models.py` (B's active file), so implementation
is sequenced after Workstream B.

## Workstream B is active in parallel

Mahmoud started a separate agent on Workstream B (drop the `@ag.reference` marker, keep
`type:"reference"`, rebuild FE #4877 on the tool type, hide embed in the UI, add env/variant to
the reference schema) on PRs #4860 / #4877.

**Shared file: `sdks/python/agenta/sdk/agents/tools/models.py`.** B edits `ReferenceToolConfig`
(adds env/variant) and removes `AG_REFERENCE_MARKER`. A adds the optional `call` field to
`CallbackToolSpec`. Different classes, same file. Per the coordination contract (first-committer
owns a shared file), A waits for B's models.py to commit, then adds `call` on top of B's version
rather than editing concurrently. Until then A does not touch models.py.

## Decided

- **2026-06-27 — env resolution timing.** Always bake the resolved revision at resolve time,
  including `environment` references. The service is always in front of the sidecar and
  re-resolves on each invoke, so the baked revision stays current. No call-time env resolution.

## Open decisions for Mahmoud

1. **When to remove the `/tools/call` `workflow.*` routing.** It is coupled to "reference goes
   direct" (Phase 4) and depends on B having landed. Recommendation: it lives in Workstream A,
   after B. If removed earlier, reference tools stop executing until A lands. This should be
   surfaced as a 🔸 Decision-needed comment on a PR.
2. **Trace-context forwarding to the sub-workflow on a reference invoke** (Phase 6, stretch).
   Nice to have; likely defer past the first cut.

## Next step

- Surface decision 1 on a PR (open a design-docs PR for this project if none exists).
- Begin Phase 1 (the `call` descriptor) on the parts that do not touch the shared models.py,
  and coordinate the models.py addition as a handoff after B commits.
- Platform tools (Phases 2-3) are largely independent of B and can proceed first.

## Board

Row claimed on `scratch/agent-coordination.md` (2026-06-27, `direct-call-tools (A)`). No `but`
write yet; BUT-LOCK left FREE; board/plan edits left unassigned.
