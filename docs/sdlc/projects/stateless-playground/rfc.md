# RFC: Stateless Playground via Bindings Adapter

## Summary

Introduce a small adapter layer (bindings) that supplies the atoms and actions the Playground UI needs. The existing app scoped playground uses an app adapter. The new stateless playground uses a stateless adapter. This lets us reuse the UI without copying components.

---

## Motivation

The current Playground is tightly coupled to apps and variants. Creating a stateless version by forking the UI would double maintenance. Instead we want a "different linker to the same components" approach.

---

## Design

### Bindings Interface

The Playground UI needs the following values and actions:

```
Inputs:
  schema       OpenAPI spec for the service
  uriInfo      Service URL info (runtimePrefix, routePath)
  promptConfig Current prompt state (messages, llm config, template format)
  testcases    Rows and columns for execution (via loadable bridge)

Outputs:
  generations  Results per row (output, latency, tokens, cost, error)

Actions:
  updatePrompt Update messages or llm config
  run          Execute the prompt against testcases
  addRow       Add a testcase row
  updateRow    Update a testcase row
  removeRow    Remove a testcase row
```

### Adapter Implementations

**App Adapter (existing behavior)**

- `schema` comes from the deployed variant openapi.json
- `uriInfo` comes from the variant deployment
- `promptConfig` comes from the revision molecule (serverData + draft)
- `testcases` come from loadable bridge (connected or local mode)
- `run` triggers the existing web worker integration
- Mounts `playgroundSyncAtom` for URL sync

**Stateless Adapter (new)**

- `schema` comes from `completionServiceSchemaAtom` (or chat)
- `uriInfo` is a fixed value: `/services/completion`
- `promptConfig` is a pure draft atom (no server data)
- `testcases` come from loadable bridge in local mode only
- `run` triggers the web worker but omits `application_id`
- Does not mount `playgroundSyncAtom`

### Provider Structure

```
StatelessPlaygroundPage
  StatelessBindingsProvider   <-- provides stateless adapter
    Playground                <-- existing component, unchanged
```

```
AppPlaygroundPage
  AppBindingsProvider         <-- provides app adapter (existing atoms)
    Playground                <-- existing component, unchanged
```

The Playground component reads from a context (or top level atom) to get bindings.

---

## Changes Required

### Phase 0: Create Bindings Seam

1. Define a `PlaygroundBindings` type.
2. Create a `PlaygroundBindingsContext` (React context).
3. Wrap existing atoms/actions into an app adapter.
4. Have `Playground.tsx` read from context instead of directly importing atoms.
5. Existing app playground route provides app adapter via context.

No user facing change in this phase.

### Phase 1: Stateless Route and State

1. Create page at `/w/{workspace_id}/p/{project_id}/playground`.
2. Add sidebar entry.
3. Implement stateless adapter:
   - Draft only prompt state (no molecule, no server data).
   - Fixed uri info.
   - Service schema from existing atoms.
4. Page provides stateless adapter via context.

### Phase 2: Wire UI

1. Conditionally hide variant selection and save actions in stateless mode.
2. Ensure header shows "Playground" without app name.
3. Ensure generation header does not show testset picker in stateless mode.

### Phase 3: Execution

1. Modify worker integration to skip `application_id` when adapter signals stateless.
2. Ensure `project_id` is always included (required for vault).
3. Confirm results flow back into the same generation state the UI reads.

### Phase 4: Polish

1. Add mode toggle for completion vs chat (uses different service schema and uri).
2. Error handling and loading states.
3. Documentation.

---

## Alternatives Considered

### Fork the Playground Component

Copy `Playground.tsx` and all subcomponents, remove app coupling.

Rejected because: high duplication, two codepaths to maintain.

### Feature Flags Inside Components

Add `if (stateless)` checks throughout the component tree.

Rejected because: pollutes existing code, harder to reason about.

### New Package for Stateless Playground

Create a separate package with its own UI.

Rejected because: duplicates presentation logic that is identical.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Bindings seam touches many files | Keep changes minimal; test app playground before merging |
| Worker application_id handling | Guard with explicit flag; regression test existing flow |
| Service schema drift | Reuse existing prefetch; no hardcoding |

---

## Open Questions

1. Should stateless playground support multi-variant comparison in the future?
   - Recommendation: no for v1; single draft only.

2. Should we persist draft state to URL hash?
   - Recommendation: no for v1; accept refresh clears state.

3. Should we track stateless runs in observability?
   - Yes. Traces will have project context but no app association.
