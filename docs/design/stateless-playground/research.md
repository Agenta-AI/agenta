# Research: Stateless Playground

## Current Playground Architecture

### URL Structure
```
/w/{workspace_id}/p/{project_id}/apps/{app_id}/playground
  ?revisions={rev_id_1},{rev_id_2}
  #pgSnapshot={encoded_draft_state}
```

### Component Hierarchy
```
PlaygroundRouter (index.tsx)
├── CustomWorkflowBanner (if app is not valid for playground)
└── Playground (Playground.tsx)
    ├── PlaygroundOnboarding
    ├── PlaygroundHeader
    │   ├── SelectVariant (multi-select for comparison)
    │   └── RunEvaluationButton
    └── PlaygroundMainView (MainLayout)
        ├── PlaygroundVariantConfig (one per displayed variant)
        │   ├── PlaygroundVariantConfigHeader
        │   └── PlaygroundVariantConfigEditors
        │       ├── PlaygroundVariantConfigPrompt
        │       └── PlaygroundVariantCustomProperties
        └── PlaygroundGenerations
            ├── GenerationHeader
            └── GenerationChat | GenerationCompletion
```

### Key Files
| File | Purpose |
|------|---------|
| `web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/playground/index.tsx` | Page component |
| `web/oss/src/components/Playground/Playground.tsx` | Main playground component |
| `web/oss/src/components/Playground/state/atoms/*.ts` | State management |
| `web/oss/src/state/newPlayground/legacyEntityBridge.ts` | Molecule bridge for revisions |
| `web/oss/src/state/newPlayground/mutations/webWorkerIntegration.ts` | Execution logic |

Additional relevant files:
- `web/oss/src/state/url/playground.ts` - URL snapshot sync (`playgroundSyncAtom`)
- `web/oss/src/components/AppGlobalWrappers/index.tsx` - Prefetches service schemas
- `web/packages/agenta-entities/src/appRevision/state/serviceSchemaAtoms.ts` - `completionServiceSchemaAtom`, `chatServiceSchemaAtom`
- `web/oss/src/components/Playground/hooks/useWebWorker/assets/playground.worker.ts` - Executes `/test`

---

## State Management Analysis

### Current Atoms
| Atom | Purpose | Stateless Equivalent |
|------|---------|---------------------|
| `selectedAppIdAtom` | App from router | Not needed |
| `selectedVariantsAtom` | Selected revision IDs | Single static ID |
| `displayedVariantsAtom` | Valid revisions to show | Props-based |
| `playgroundRevisionListAtom` | Server + draft revisions | In-memory draft only |
| `playgroundAppSchemaAtom` | OpenAPI schema from variant | Static schema |
| `playgroundAppUriInfoAtom` | URI from variant | Static completion URI |

### Molecule Pattern
The current playground uses `legacyAppRevisionMolecule` for revision state:
```typescript
legacyAppRevisionMolecule.atoms.data(revisionId)       // Merged data
legacyAppRevisionMolecule.atoms.serverData(revisionId) // Server data
legacyAppRevisionMolecule.atoms.draft(revisionId)      // Local changes
legacyAppRevisionMolecule.atoms.isDirty(revisionId)    // Dirty tracking
```

For stateless, we need **draft-only** state with no server data.

---

## Completion Service Analysis

### Service Location
- `services/oss/src/completion.py` - Single-turn completion
- `services/oss/src/chat.py` - Multi-turn chat

### Endpoints
| Endpoint | Mode | Description |
|----------|------|-------------|
| `/test` | Inline | Config passed in request body |
| `/run` | Deployed | Config fetched from backend via references |

### `/test` Endpoint (What We Need)

**Request:**
```json
{
  "ag_config": {
    "prompt": {
      "llm_config": {
        "model": "gpt-4",
        "temperature": 0.7,
        "max_tokens": 1000
      },
      "messages": [
        {"role": "system", "content": "You are an expert."},
        {"role": "user", "content": "Question: {question}"}
      ],
      "template_format": "fstring"
    }
  },
  "inputs": {"question": "What is 2+2?"}
}
```

**Response:**
```json
{
  "version": "3.0",
  "data": "4",
  "tree": {
    "nodes": [{
      "trace_id": "...",
      "metrics": {
        "acc": {
          "duration": {"total": 1234},
          "costs": {"total": 0.001},
          "tokens": {"total": 150}
        }
      }
    }]
  }
}
```

### Key Finding: Can Call Without App

The `/test` endpoint can be called without a real app/variant because configuration is passed inline.

Important details for stateless mode:
- `project_id` is required so the service can resolve vault secrets in the right project.
- `application_id` should be omitted.

Why omit `application_id`:
- The current worker always appends `application_id`.
- If `application_id` is present but not a UUID, backend middleware may attempt to resolve app info and fail UUID validation.
- Stateless mode has no real app id, so omitting it avoids a class of 500/422 style failures.

---

## Loadable System Analysis

### How It Works
The loadable system manages test case rows for playground execution:
```
loadableBridge.selectors.rows(loadableId)    // Get rows
loadableBridge.selectors.columns(loadableId) // Get columns
loadableBridge.actions.addRow(loadableId)    // Add row
loadableBridge.actions.updateRow(...)        // Update row
```

### Local vs Connected Mode
| Mode | Behavior |
|------|----------|
| **Local** | In-memory only, no persistence |
| **Connected** | Synced with testset revision |

### Key Finding: Local Mode is Perfect

The loadable system already supports stateless operation:
```typescript
// From store.ts - local entities skip server queries
const isLocalEntity = testcaseId.startsWith("new-")
return {
    enabled: !isLocalEntity && ...  // Disabled for local
}
```

We can use the loadable system with:
- `loadableId` = `"stateless-playground"`
- Mode = `"local"` (never connect to source)
- Columns derived from prompt variables

---

## Execution Flow Analysis

### Current Flow
```
1. User clicks Run
2. triggerWebWorkerTestAtom prepares payload:
   - variant (from molecule)
   - prompts (enhanced with schema)
   - uri (from variant)
   - spec (OpenAPI schema)
3. Web Worker transforms config
4. Worker calls POST /test
5. handleWebWorkerResultAtom processes response
```

### Changes Needed

| Current | Stateless |
|---------|-----------|
| URI from variant | Static completion service URL |
| Schema from deployed variant | Static/hardcoded schema |
| Config from molecule | Direct from state |
| app_id from router | Use project_id or placeholder |

Update based on further findings:
- Prefer service schema fetching over hardcoding.
- Do not send a placeholder app id.

---

## UI Component Reusability

### Highly Reusable (presentation only)
| Component | Why Reusable |
|-----------|-------------|
| `PlaygroundVariantConfigPrompt` | Pure prompt editing UI |
| `PromptMessageContent` | Message editing (multimodal) |
| `PlaygroundVariantModelConfig` | Model settings controls |
| `GenerationChat` / `GenerationCompletion` | Output display |
| `SharedEditor` | Monaco editor |
| `RunButton` | Simple trigger |

### Need Modification (state-bound)
| Component | Current Dependency | Change Needed |
|-----------|-------------------|---------------|
| `PlaygroundHeader` | `selectedAppIdAtom`, URL sync | Simplify significantly |
| `SelectVariant` | App-scoped variant listing | Remove entirely |
| `PlaygroundMainView` | `displayedVariantsAtom` | Accept config as props |
| `GenerationHeader` | Testset loading, deployment | Simplify |

### New Code Needed (with Adapter Approach)

| Item | Reason |
|------|--------|
| `StatelessPlaygroundPage` | New page at project level |
| `StatelessBindingsAdapter` | Provides stateless values to the Playground UI |
| `PlaygroundBindingsContext` | Context that the UI reads from |

Note: with the bindings adapter approach, we do NOT need to create a separate header or duplicate prompt editor components. The existing UI reads from the context and adapts.

---

## Complexity Assessment

### Complexity: **Medium-High**

**Why Medium:**
- Core primitives exist (completion `/test` endpoint, loadable local mode)
- Many UI components can be reused
- Clear separation of concerns in current architecture

**Why High:**
- Deep coupling of playground to app/variant context
- Web Worker integration assumes variant-based URIs
- Schema derivation tied to deployed variants
- URL sync system needs bypass

### Effort Estimate
| Task | Effort |
|------|--------|
| New page + routing | Small |
| State management | Medium |
| Adapt execution flow | Medium |
| UI components | Medium |
| Testing + polish | Medium |
| **Total** | ~2-3 weeks |

---

## Technical Decisions Needed

1. **Schema handling**: Fetch from service schema endpoint or hardcode?
3. **Mode**: Support both completion and chat, or start with completion only?
4. **State persistence**: Use URL hash for draft state (like current playground)?
5. **Sidebar entry**: New sidebar item or link from somewhere?

Recommended defaults:
- Schema: fetch from `/services/completion/openapi.json` via existing service schema atoms.
- Mode: completion only for v1, add chat after bindings are stable.
- State persistence: none (refresh clears) for v1.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Vault access without app | Use project-level vault access (already supported) |
| Tracing lacks app association | Accept for v1 (project context still exists) |
| Schema mismatch | Fetch service schema from the service itself |
| State loss on refresh | Accept as expected behavior OR use URL hash |

---

## Service Schema Strategy

The repo already fetches deterministic service schemas:
- `fetchServiceSchema()` hits `/services/{serviceType}/openapi.json` with optional `project_id`.
- Atoms exist for completion and chat schemas (`completionServiceSchemaAtom`, `chatServiceSchemaAtom`).
- OSS prefetches these schemas globally via `web/oss/src/components/AppGlobalWrappers/index.tsx`.

Stateless playground should reuse these atoms instead of fetching `openapi.json` from a deployed app.

---

## URL Sync Strategy

The app scoped playground mounts `playgroundSyncAtom` which:
- hydrates selection and draft state from the URL
- writes snapshot state back into the URL hash
- cleans up stale ids

Stateless playground should not mount this behavior.
It should keep state in memory only.

---

## Existing Adapter and DI Patterns

Several DI/adapter patterns exist in the codebase:

| File | Pattern |
|------|---------|
| `web/oss/src/components/Playground/context/PromptsSource.tsx` | Prompt injection context |
| `web/packages/agenta-playground/src/state/context/PlaygroundEntityContext.tsx` | Entity context |
| `web/packages/agenta-playground-ui/src/context/PlaygroundUIContext.tsx` | UI context |
| `web/oss/src/components/Playground/state/atoms/playgroundSelectionAdapter.ts` | `createLegacyAppRevisionAdapter` |
| `web/oss/src/lib/hooks/useStatelessVariants/index.ts` | Stateless bundle for specMap and uriMap |

These patterns show that the codebase already supports decoupling data sources from UI.

---

## Sidebar Configuration

File: `web/oss/src/components/Sidebar/hooks/useSidebarConfig/index.tsx`

Project level links use `${projectURL}/...` pattern.

Current project entries:
- Prompts: `${projectURL}/prompts`
- Test sets: `${projectURL}/testsets`
- Evaluators: `${projectURL}/evaluators`
- Evaluations: `${projectURL}/evaluations`
- Observability: `${projectURL}/observability`

Add new entry after Prompts:
- Playground: `${projectURL}/playground`

---

## Technical Decisions Summary

| Decision | Recommended Choice | Rationale |
|----------|-------------------|-----------|
| App ID for tracing | Omit entirely | Backend handles missing app id; avoids UUID validation failures |
| Schema source | Use `completionServiceSchemaAtom` | Already fetched and cached globally |
| Initial mode | Completion only | Simpler; add chat later |
| URL state | No persistence | Matches user expectation of ephemeral session |
| Sidebar location | Project section (after Prompts) | Matches user request for project level page |
