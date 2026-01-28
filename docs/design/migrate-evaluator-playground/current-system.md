# Current System: Evaluator Playground

## Overview

The Evaluator Playground allows users to:
1. **Browse** evaluator templates (built-in evaluators)
2. **Create/Configure** evaluator configurations with custom settings
3. **Test** evaluators by running them against app variants and test cases
4. **Manage** (edit, clone, delete) existing evaluator configurations

## File Structure

### Entry Points (Pages)

| Path | Purpose |
|------|---------|
| `/web/oss/src/pages/w/[workspace_id]/p/[project_id]/evaluators/index.tsx` | Evaluators list page |
| `/web/oss/src/pages/w/[workspace_id]/p/[project_id]/evaluators/configure/[evaluator_id].tsx` | Configure evaluator page |

### Core Components

#### Evaluators Registry (`/web/oss/src/components/Evaluators/`)

| File | Purpose |
|------|---------|
| `index.tsx` | Main registry with table, search, tabs (automatic/human) |
| `hooks/useEvaluatorsRegistryData.ts` | Fetches and transforms evaluator data |
| `assets/getColumns.tsx` | Table column definitions |
| `components/SelectEvaluatorModal/` | Modal to select evaluator template for new config |
| `components/ConfigureEvaluator/index.tsx` | Page wrapper that loads data and initializes atoms |
| `components/DeleteEvaluatorsModal/` | Delete confirmation modal |

#### ConfigureEvaluator (Main UI) 

Location: `/web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/`

| File | Purpose |
|------|---------|
| `index.tsx` | Configuration form + test panel layout |
| `DebugSection.tsx` | Test evaluator panel (run variant, run evaluator) |
| `DynamicFormField.tsx` | Renders settings fields based on evaluator template |
| `AdvancedSettings.tsx` | Collapsible advanced parameters |
| `state/atoms.ts` | Jotai atoms for playground state |
| `variantUtils.ts` | Utility for building variants from revisions |

### State Management

#### Playground Atoms (`state/atoms.ts`)

```typescript
// Session state
playgroundSessionAtom          // { evaluator, existingConfigId, mode }
playgroundEvaluatorAtom        // Current evaluator template (derived)
playgroundIsEditModeAtom       // Is editing existing config? (derived)
playgroundIsCloneModeAtom      // Is cloning config? (derived)
playgroundEditValuesAtom       // Current config values being edited

// Form state
playgroundFormRefAtom          // Ant Design Form instance

// Test section state
playgroundSelectedVariantAtom  // Selected variant for testing
playgroundSelectedTestsetIdAtom // Selected testset ID
playgroundSelectedRevisionIdAtom // Selected revision ID
playgroundSelectedTestcaseAtom // Testcase data
playgroundTraceTreeAtom        // Trace output from running variant

// Persisted state (localStorage)
playgroundLastAppIdAtom        // Last used app ID
playgroundLastVariantIdAtom    // Last used variant ID

// Action atoms
initPlaygroundAtom             // Initialize playground state
resetPlaygroundAtom            // Reset all state
commitPlaygroundAtom           // Update state after save
cloneCurrentConfigAtom         // Switch to clone mode
```

#### Global Evaluator Atoms (`/web/oss/src/state/evaluators/atoms.ts`)

```typescript
evaluatorConfigsQueryAtomFamily // Query for evaluator configs
evaluatorsQueryAtomFamily       // Query for evaluator templates
nonArchivedEvaluatorsAtom       // Derived: non-archived evaluators
evaluatorByKeyAtomFamily        // Find evaluator by key
```

### API Service Layer

#### Evaluators Service (`/web/oss/src/services/evaluators/index.ts`)

```typescript
// Evaluator Templates (legacy)
fetchAllEvaluators()           // GET /evaluators

// Evaluator Configs (legacy)
fetchAllEvaluatorConfigs()     // GET /evaluators/configs
createEvaluatorConfig()        // POST /evaluators/configs
updateEvaluatorConfig()        // PUT /evaluators/configs/{id}
deleteEvaluatorConfig()        // DELETE /evaluators/configs/{id}

// Custom/Human Evaluators (new)
createEvaluator()              // POST /preview/simple/evaluators/
updateEvaluator()              // PUT /preview/simple/evaluators/{id}
fetchEvaluatorById()           // GET /preview/simple/evaluators/{id}
deleteHumanEvaluator()         // POST /preview/simple/evaluators/{id}/archive
```

#### Evaluator Run Service (`/web/oss/src/services/evaluations/api_ee/index.ts`)

```typescript
createEvaluatorDataMapping()   // POST /evaluators/map
createEvaluatorRunExecution()  // POST /evaluators/{key}/run
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER ACTIONS                                       │
│  - Browse evaluators list                                                   │
│  - Create new evaluator config                                              │
│  - Edit existing evaluator config                                           │
│  - Test evaluator with variant + testcase                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                                │
│  /evaluators → EvaluatorsRegistry                                           │
│       ├─ Uses useEvaluatorsRegistryData() hook                              │
│       │     ├─ Calls fetchAllEvaluators() → GET /evaluators                 │
│       │     └─ Calls fetchAllEvaluatorConfigs() → GET /evaluators/configs   │
│       │                                                                      │
│       ├─ "Create new" → SelectEvaluatorModal → /evaluators/configure/new    │
│       └─ Click row → /evaluators/configure/{id}                             │
│                                                                              │
│  /evaluators/configure/{id} → ConfigureEvaluatorPage                        │
│       ├─ Loads evaluator template & existing config                         │
│       ├─ Initializes playgroundSessionAtom                                  │
│       └─ Renders ConfigureEvaluator component                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ConfigureEvaluator                                                          │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐           │
│  │  LEFT: Configuration Form   │  │  RIGHT: DebugSection        │           │
│  │  - Name input               │  │  - Testcase selector        │           │
│  │  - DynamicFormField[]       │  │  - Variant selector         │           │
│  │  - AdvancedSettings         │  │  - Run variant button       │           │
│  │  - Commit/Reset buttons     │  │  - Run evaluator button     │           │
│  └─────────────────────────────┘  └─────────────────────────────┘           │
│                                                                              │
│  Commit Actions:                                                             │
│  - Create: POST /evaluators/configs → createEvaluatorConfig()               │
│  - Update: PUT /evaluators/configs/{id} → updateEvaluatorConfig()           │
│                                                                              │
│  Test Actions:                                                               │
│  - Run Variant: callVariant() → POST to variant URL                         │
│  - Run Evaluator: createEvaluatorRunExecution()                             │
│                   → POST /evaluators/{key}/run                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Current API Endpoints Used

### Legacy Endpoints (to be migrated)

| Endpoint | Method | Frontend Function | Purpose |
|----------|--------|-------------------|---------|
| `/evaluators/` | GET | `fetchAllEvaluators()` | List evaluator templates |
| `/evaluators/configs/` | GET | `fetchAllEvaluatorConfigs()` | List evaluator configs |
| `/evaluators/configs/` | POST | `createEvaluatorConfig()` | Create new config |
| `/evaluators/configs/{id}/` | PUT | `updateEvaluatorConfig()` | Update existing config |
| `/evaluators/configs/{id}/` | DELETE | `deleteEvaluatorConfig()` | Delete config |

### Endpoints That Remain Unchanged

| Endpoint | Method | Frontend Function | Purpose |
|----------|--------|-------------------|---------|
| `/evaluators/map/` | POST | `createEvaluatorDataMapping()` | Map trace data for RAG evaluators |
| `/evaluators/{key}/run/` | POST | `createEvaluatorRunExecution()` | Run evaluator (test) |

### Already Using New Endpoints (for custom evaluators)

| Endpoint | Method | Frontend Function | Purpose |
|----------|--------|-------------------|---------|
| `/preview/simple/evaluators/` | POST | `createEvaluator()` | Create custom evaluator |
| `/preview/simple/evaluators/{id}` | PUT | `updateEvaluator()` | Update custom evaluator |
| `/preview/simple/evaluators/{id}` | GET | `fetchEvaluatorById()` | Fetch evaluator by ID |
| `/preview/simple/evaluators/{id}/archive` | POST | `deleteHumanEvaluator()` | Archive human evaluator |

## Data Types

### Current EvaluatorConfig (Legacy)

```typescript
interface EvaluatorConfig {
    id: string
    evaluator_key: string
    name: string
    settings_values: Record<string, any>
    created_at: string
    updated_at: string
    color?: string
    tags?: string[]
    // Frontend additions
    icon_url?: string | StaticImageData
}
```

### Current Evaluator Template (Legacy)

```typescript
interface Evaluator {
    name: string
    key: string
    settings_presets?: SettingsPreset[]
    settings_template: Record<string, EvaluationSettingsTemplate>
    icon_url?: string | StaticImageData
    color?: string
    direct_use?: boolean
    description: string
    oss?: boolean
    requires_llm_api_keys?: boolean
    tags: string[]
    archived?: boolean
}
```
