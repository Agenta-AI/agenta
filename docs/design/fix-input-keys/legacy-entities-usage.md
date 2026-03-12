# Legacy Entities Usage

This note answers: are old entities still used for prompts or playground behavior?

## Short Answer

- The main OSS playground path is now workflow-based.
- Legacy entities are still present in the codebase and still power some compatibility and fallback flows.
- I did not find the main prompt config editing flow in the OSS playground using `legacyAppRevision` directly.
- There are still some user-visible playground entry points and fallback CRUD branches that use legacy entities.

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

## Legacy Entities Still Have Active Usage

### User-visible entry points

- `web/oss/src/components/Playground/Components/MainLayout/index.tsx:89` - the empty-state "Add to Playground" selector is still restricted to `legacyAppRevision`
- `web/packages/agenta-playground-ui/src/components/EntitySelector/EntitySelector.tsx:85` - the app-revision picker still uses the legacy adapter

### Fallback CRUD logic

`playgroundController` still has separate legacy branches for non-workflow entities:

- `web/packages/agenta-playground/src/state/controllers/playgroundController.ts:1500` - legacy create variant path
- `web/packages/agenta-playground/src/state/controllers/playgroundController.ts:1564` - legacy commit path
- `web/packages/agenta-playground/src/state/controllers/playgroundController.ts:1647` - legacy delete path

### Snapshot / compatibility behavior

- `web/packages/agenta-playground/src/state/controllers/playgroundController.ts:1712` - unknown entity IDs still default to `legacyAppRevision`
- `web/packages/agenta-playground/src/state/controllers/playgroundSnapshotController.ts:23` - legacy snapshot adapter is still registered
- `web/oss/src/components/Playground/OSSPlaygroundEntityProvider.tsx:26` - legacy side-effect bridge is still imported

### One prompt-related legacy-backed helper

I did not find the main playground prompt editor using legacy state directly, but there is still a prompt-related legacy-backed helper outside the main config editor:

- `web/oss/src/state/newPlayground/legacyEntityBridge.ts:64` - exports `moleculeBackedPromptsAtomFamily`
- `web/oss/src/features/gateway-tools/prompt/atoms.ts:53` - uses that legacy-backed prompts atom

## Conclusion

- Yes, legacy entities are still used in the repository and in some active UI flows.
- No, the main OSS playground prompt editing/config path does not appear to be primarily legacy-backed anymore.
- For this bug, if the customer repro is on the modern playground flow, the safest implementation scope is the workflow/new-entities path.
- Legacy-specific fixes should only be added if we reproduce the bug through one of the known legacy entry points.
