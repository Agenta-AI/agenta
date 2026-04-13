# Legacy Entities Usage

> **Update:** `legacyAppRevision` has been fully removed from the codebase. All playground paths now use `workflow` entities exclusively. This document is kept for historical context.

This note answers: are old entities still used for prompts or playground behavior?

## Short Answer

- The OSS playground is fully workflow-based. `legacyAppRevision` has been removed.
- All fallback flows and compatibility shims previously using legacy entities have been migrated to workflow.

## Main Playground Path Is Workflow-Based

These files indicate the modern path is workflow-first:

- `web/oss/src/state/url/playground.ts:36` - comment says the playground entity mode is currently always workflow
- `web/oss/src/state/url/playground.ts:40` - `playgroundEntityModeAtom` is hardcoded to `"workflow"`
- `web/oss/src/components/Playground/OSSPlaygroundEntityProvider.tsx:30` - provider wires workflow selectors
- `web/oss/src/components/Playground/OSSPlaygroundEntityProvider.tsx:31` - comment calls workflow the modern `/preview/workflows/` path
- `web/oss/src/components/Playground/Components/Menus/SelectVariant/index.tsx:119` - main selector uses workflow revision adapters
- `web/packages/agenta-entities/src/runnable/bridge.ts:860` - workflow is the first runnable type registered

## Prompt Editing Appears To Use New Entities

The active playground config editing path uses `runnableBridge.update`, which routes workflow entities into the workflow molecule update path:

- `web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx:145` - writes via `runnableBridge.update`
- `web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx:189` - adapter binds update reducer to `runnableBridge.update`
- `web/packages/agenta-entities/src/shared/createEntityBridge.ts:1160` - bridge update action routes to the matching molecule action
- `web/packages/agenta-entities/src/workflow/state/molecule.ts:329` - workflow update action is `updateWorkflowDraftAtom`
- `web/packages/agenta-entities/src/workflow/state/store.ts:1135` - workflow draft mutation happens here

This is the strongest evidence that the current prompt/config editing flow for workflow entities is on the new entities path.

## Legacy Entities (REMOVED)

All legacy entity usage described below has been removed. The `legacyAppRevision` package, legacy entity bridge, legacy snapshot adapter, and all fallback CRUD branches have been deleted. All paths now use `workflow` entities exclusively.

## Conclusion

- Legacy entities have been fully removed from the codebase.
- The OSS playground prompt editing/config path uses workflow entities exclusively.
- For this bug, the implementation scope is the workflow/new-entities path only.
