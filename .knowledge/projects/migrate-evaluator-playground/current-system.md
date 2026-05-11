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
// Evaluator Templates
fetchAllEvaluators()           // GET /evaluators

// Evaluator Configs
fetchAllEvaluatorConfigs()     // POST /simple/evaluators/query
createEvaluatorConfig()        // POST /simple/evaluators/
updateEvaluatorConfig()        // PUT /simple/evaluators/{id}
deleteEvaluatorConfig()        // POST /simple/evaluators/{id}/archive

// Custom/Human Evaluators
createEvaluator()              // POST /simple/evaluators/
updateEvaluator()              // PUT /simple/evaluators/{id}
fetchEvaluatorById()           // GET /simple/evaluators/{id}
deleteHumanEvaluator()         // POST /simple/evaluators/{id}/archive
```

#### Evaluator Run Service (`/web/oss/src/services/workflows/invoke.ts`)

```typescript
invokeEvaluator()              // POST /workflows/invoke
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
│       │     └─ Calls fetchAllEvaluatorConfigs() → POST /simple/evaluators/query │
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
│  - Create: POST /simple/evaluators → createEvaluatorConfig()        │
│  - Update: PUT /simple/evaluators/{id} → updateEvaluatorConfig()    │
│                                                                              │
│  Test Actions:                                                               │
│  - Run Variant: callVariant() → POST to variant URL                         │
│  - Run Evaluator: invokeEvaluator()                                         │
│                   → POST /workflows/invoke                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Current API Endpoints Used

### Evaluator Templates

| Endpoint | Method | Frontend Function | Purpose |
|----------|--------|-------------------|---------|
| `/evaluators/` | GET | `fetchAllEvaluators()` | List evaluator templates |

### Evaluator CRUD

| Endpoint | Method | Frontend Function | Purpose |
|----------|--------|-------------------|---------|
| `/simple/evaluators/query` | POST | `fetchAllEvaluatorConfigs()` | List evaluator configs |
| `/simple/evaluators/` | POST | `createEvaluatorConfig()` | Create evaluator config |
| `/simple/evaluators/{id}` | PUT | `updateEvaluatorConfig()` | Update evaluator config |
| `/simple/evaluators/{id}/archive` | POST | `deleteEvaluatorConfig()` | Archive evaluator config |

### Evaluator Run (Playground)

| Endpoint | Method | Frontend Function | Purpose |
|----------|--------|-------------------|---------|
| `/workflows/invoke` | POST | `invokeEvaluator()` | Run evaluator using workflow invocation |

## Data Types

### Current Evaluator Config

```typescript
interface SimpleEvaluator {
    id: string
    slug: string
    name?: string
    description?: string
    tags?: string[]
    flags?: {
        is_custom?: boolean
        is_evaluator?: boolean
        is_human?: boolean
    }
    data?: {
        uri?: string
        parameters?: Record<string, any>
        schemas?: {
            outputs?: Record<string, any>
        }
    }
    created_at: string
    updated_at: string
}
```

### Current Evaluator Template

```typescript
interface Evaluator {
    name: string
    key: string
    settings_presets?: SettingsPreset[]
    settings_template: Record<string, EvaluationSettingsTemplate>
    outputs_schema?: Record<string, any>
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
