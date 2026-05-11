# Status

## Current State: Workflow Draft-Mutation Fix Implemented

### Completed
- [x] Reproduced the issue
- [x] Traced the full data flow (frontend → API → storage → runtime)
- [x] Identified root cause: `syncInputKeysInPrompts` removed in refactor, never replaced
- [x] Identified secondary issue: `requestBodyBuilder.ts` only sets input_keys on first prompt
- [x] Analyzed git history to confirm when and why the regression was introduced
- [x] Created implementation plan
- [x] Re-reviewed plan against lead feedback
- [x] Implemented workflow draft-time `input_keys` synchronization
- [x] Documented current legacy entity usage
- [x] Ran frontend lint

### Key Findings

1. **`syncInputKeysInPrompts`** is defined but never called (all call sites removed in `56bd5e329`)
2. **The better seam for new entities is draft update, not commit**:
   - `PlaygroundConfigSection` writes via `runnableBridge.update`
   - workflow updates route to `workflowMolecule.actions.update`
   - that lands in `updateWorkflowDraftAtom`
3. **`requestBodyBuilder.ts`** only sets `input_keys` on `Object.keys(ag_config)[0]` (first prompt only), but this is invocation-path behavior and should likely stay out of this fix
4. **The API** is a transparent pass-through — it does not compute `input_keys`, just stores what it receives
5. **Explicit type metadata already exists** and should be used for gating:
   - workflow flags for preview workflows
   - app type / resolved service type for legacy apps
6. **Legacy path is still present in the codebase**, but if this issue is known to be on new entities, the safest fix scope is workflow-only

### Implementation Notes

- Added `syncPromptInputKeysInParameters()` to `web/packages/agenta-entities/src/runnable/utils.ts`
- Wired it into `web/packages/agenta-entities/src/workflow/state/store.ts` inside `updateWorkflowDraftAtom`
- Gated the normalization using workflow flags:
  - skip `is_custom`
  - skip `is_evaluator`
  - skip `is_human`
- Left commit logic unchanged
- Left `requestBodyBuilder.ts` unchanged for this fix

### Next Steps
- [x] Implement `syncPromptInputKeysInParameters()` in `runnable/utils.ts`
- [x] Wire it into `updateWorkflowDraftAtom()` with workflow-flag gating
- [ ] Test workflow prompt, custom, and evaluator draft-update paths in the app
- [ ] Verify commit persistence after draft normalization with a real repro flow
- [x] Lint and build
