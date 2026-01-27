# Migration Plan: Evaluator Playground

## Overview

This plan outlines an incremental migration approach that minimizes risk and allows for gradual rollout. The key principle is **transform at boundaries** - keep internal data shapes stable and only change API interactions.

## Migration Strategy

Two viable strategies exist:

- Plan A (transitional): adapter pattern, keep internal legacy `EvaluatorConfig` shape
- Plan B (preferred destination): direct migration, internal shapes become `SimpleEvaluator` + native invoke

This file documents Plan A as the low-risk execution plan. For the direct plan, see `docs/design/migrate-evaluator-playground/migration-options.md`.

## Plan A: Adapter Pattern

Instead of changing data shapes throughout the codebase, we'll:
1. Create adapter functions at the API boundary
2. New endpoints return `SimpleEvaluator`, adapters convert to internal `EvaluatorConfig` shape
3. Internal components continue working unchanged
4. Gradually update internals later (optional)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  New API     │ ──► │   Adapter    │ ──► │  Internal Shape  │
│  Endpoints   │     │   Layer      │     │  (unchanged)     │
└──────────────┘     └──────────────┘     └──────────────────┘
```

---

## Phase 1: Foundation (Low Risk)

**Goal:** Create adapter layer and new service functions without changing existing code

### Tasks

#### 1.1 Create Type Definitions

**File:** `web/oss/src/lib/Types.ts` or new file `web/oss/src/services/evaluators/types.ts`

```typescript
// New API types
interface SimpleEvaluatorData {
    version?: string
    uri?: string
    url?: string
    headers?: Record<string, string>
    schemas?: { outputs?: Record<string, any> }
    script?: { content: string; runtime: string }
    parameters?: Record<string, any>
}

interface SimpleEvaluatorFlags {
    is_custom?: boolean
    is_evaluator?: boolean
    is_human?: boolean
}

interface SimpleEvaluator {
    id: string
    slug: string
    name?: string
    description?: string
    tags?: string[]
    meta?: Record<string, any>
    flags?: SimpleEvaluatorFlags
    data?: SimpleEvaluatorData
    created_at: string
    updated_at: string
}

interface SimpleEvaluatorResponse {
    count: number
    evaluator: SimpleEvaluator | null
}

interface SimpleEvaluatorsResponse {
    count: number
    evaluators: SimpleEvaluator[]
}
```

#### 1.2 Create Adapter Functions

**File:** `web/oss/src/services/evaluators/adapters.ts`

```typescript
import { EvaluatorConfig } from "@/oss/lib/Types"
import { SimpleEvaluator, SimpleEvaluatorData } from "./types"
import { getTagColors } from "@/oss/lib/helpers/colors"
import { stringToNumberInRange } from "@/oss/lib/helpers/utils"

/**
 * Extract evaluator_key from URI
 * URI format: "agenta:builtin:{key}:v0"
 */
export function extractEvaluatorKey(uri: string | undefined): string {
    if (!uri) return ""
    const parts = uri.split(":")
    if (parts.length >= 3 && parts[0] === "agenta" && parts[1] === "builtin") {
        return parts[2]
    }
    return ""
}

/**
 * Build URI from evaluator key
 */
export function buildEvaluatorUri(evaluatorKey: string): string {
    return `agenta:builtin:${evaluatorKey}:v0`
}

/**
 * Convert SimpleEvaluator to internal EvaluatorConfig shape
 */
export function simpleEvaluatorToConfig(
    simple: SimpleEvaluator,
    projectId?: string
): EvaluatorConfig {
    const tagColors = getTagColors()
    const evaluatorKey = extractEvaluatorKey(simple.data?.uri)
    
    return {
        id: simple.id,
        name: simple.name || "",
        evaluator_key: evaluatorKey,
        settings_values: simple.data?.parameters || {},
        created_at: simple.created_at,
        updated_at: simple.updated_at,
        // Frontend additions
        color: tagColors[stringToNumberInRange(evaluatorKey, 0, tagColors.length - 1)],
        tags: simple.tags,
    }
}

/**
 * Convert internal EvaluatorConfig to SimpleEvaluator create payload
 */
export function configToSimpleEvaluatorCreate(
    config: Omit<EvaluatorConfig, "id" | "created_at">,
    outputsSchema?: Record<string, any>
): SimpleEvaluatorCreate {
    return {
        slug: generateSlug(config.name),
        name: config.name,
        flags: { is_evaluator: true },
        data: {
            uri: buildEvaluatorUri(config.evaluator_key),
            parameters: config.settings_values,
            schemas: outputsSchema ? { outputs: outputsSchema } : undefined,
        },
    }
}

/**
 * Generate slug from name
 */
function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
}
```

#### 1.3 Create New Service Functions

**File:** `web/oss/src/services/evaluators/index.ts` (add to existing)

```typescript
// === NEW ENDPOINT FUNCTIONS ===

export const fetchAllEvaluatorConfigsV2 = async (
    projectIdOverride?: string | null,
): Promise<EvaluatorConfig[]> => {
    const {projectId: projectIdFromStore} = getProjectValues()
    const projectId = projectIdOverride ?? projectIdFromStore

    if (!projectId) return []

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/query?project_id=${projectId}`,
        { flags: { is_evaluator: true } }
    )
    
    const evaluators = response.data?.evaluators || []
    return evaluators.map((e: SimpleEvaluator) => simpleEvaluatorToConfig(e, projectId))
}

export const createEvaluatorConfigV2 = async (
    config: CreateEvaluationConfigData,
): Promise<EvaluatorConfig> => {
    const {projectId} = getProjectValues()
    
    const payload = configToSimpleEvaluatorCreate(config)
    
    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/?project_id=${projectId}`,
        payload,
    )
    
    const simple = response.data?.evaluator
    if (!simple) throw new Error("Failed to create evaluator")
    
    return simpleEvaluatorToConfig(simple, projectId)
}

export const updateEvaluatorConfigV2 = async (
    configId: string,
    config: Partial<CreateEvaluationConfigData>,
): Promise<EvaluatorConfig> => {
    const {projectId} = getProjectValues()

    const payload: SimpleEvaluatorEdit = {
        id: configId,
        name: config.name,
        data: config.settings_values 
            ? { parameters: config.settings_values }
            : undefined,
    }

    const response = await axios.put(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${configId}?project_id=${projectId}`,
        payload,
    )
    
    const simple = response.data?.evaluator
    if (!simple) throw new Error("Failed to update evaluator")
    
    return simpleEvaluatorToConfig(simple, projectId)
}

export const deleteEvaluatorConfigV2 = async (configId: string): Promise<boolean> => {
    const {projectId} = getProjectValues()

    await axios.post(
        `${getAgentaApiUrl()}/preview/simple/evaluators/${configId}/archive?project_id=${projectId}`,
    )
    
    return true
}
```

**Deliverables:**
- [ ] Type definitions for new API shapes
- [ ] Adapter functions (both directions)
- [ ] New service functions with V2 suffix
- [ ] Unit tests for adapters

**Estimated Effort:** 1-2 days

---

## Phase 2: Feature Flag Integration (Low Risk)

**Goal:** Add feature flag to toggle between old and new endpoints

### Tasks

#### 2.1 Add Feature Flag

**File:** `web/oss/src/lib/helpers/featureFlags.ts` or environment config

```typescript
export const USE_NEW_EVALUATOR_ENDPOINTS = 
    process.env.NEXT_PUBLIC_USE_NEW_EVALUATOR_ENDPOINTS === "true"
```

#### 2.2 Create Unified Service Functions

**File:** `web/oss/src/services/evaluators/index.ts`

```typescript
// Unified functions that use feature flag
export const fetchAllEvaluatorConfigs = async (...args) => {
    if (USE_NEW_EVALUATOR_ENDPOINTS) {
        return fetchAllEvaluatorConfigsV2(...args)
    }
    return fetchAllEvaluatorConfigsLegacy(...args)
}

export const createEvaluatorConfig = async (...args) => {
    if (USE_NEW_EVALUATOR_ENDPOINTS) {
        return createEvaluatorConfigV2(...args)
    }
    return createEvaluatorConfigLegacy(...args)
}

// ... same for update and delete
```

**Deliverables:**
- [ ] Feature flag configuration
- [ ] Unified service functions with flag branching
- [ ] Documentation for enabling flag

**Estimated Effort:** 0.5 days

---

## Phase 3: Integration Testing (Medium Risk)

**Goal:** Verify new endpoints work correctly with existing UI

### Tasks

#### 3.1 Enable Feature Flag in Development

- Set `NEXT_PUBLIC_USE_NEW_EVALUATOR_ENDPOINTS=true` in dev environment
- Test all evaluator playground flows

#### 3.2 Test Cases

1. **List Evaluators**
   - [ ] Registry shows all existing evaluator configs
   - [ ] Correct names, types, and icons displayed
   - [ ] Filtering and search work

2. **Create Evaluator**
   - [ ] Select template → Configure → Commit
   - [ ] Settings saved correctly
   - [ ] Redirects to edit page after create

3. **Edit Evaluator**
   - [ ] Load existing config
   - [ ] Form populated with current values
   - [ ] Update settings
   - [ ] Changes persisted

4. **Delete Evaluator**
   - [ ] Delete confirmation works
   - [ ] Evaluator removed from list
   - [ ] No errors

5. **Test Evaluator**
   - [ ] Load testcase
   - [ ] Run variant
   - [ ] Run evaluator
   - [ ] Results displayed correctly

**Deliverables:**
- [ ] Test results document
- [ ] Bug fixes for any issues found
- [ ] Performance comparison (if applicable)

**Estimated Effort:** 2-3 days

---

## Phase 4: Gradual Rollout (Low Risk)

**Goal:** Enable new endpoints for subset of users

### Tasks

#### 4.1 Staged Rollout

1. **Internal testing:** Enable for team members only
2. **Beta users:** Enable for opt-in users
3. **General availability:** Enable for all users

#### 4.2 Monitoring

- Monitor error rates for evaluator operations
- Track API response times
- Watch for unexpected 404/500 errors

**Deliverables:**
- [ ] Rollout schedule
- [ ] Rollback procedure documented
- [ ] Monitoring dashboards/alerts

**Estimated Effort:** 1-2 weeks (elapsed time)

---

## Phase 5: Cleanup (Low Risk)

**Goal:** Remove legacy code and feature flag

### Tasks

#### 5.1 Remove Legacy Functions

- Remove `fetchAllEvaluatorConfigsLegacy`
- Remove `createEvaluatorConfigLegacy`
- Remove `updateEvaluatorConfigLegacy`
- Remove `deleteEvaluatorConfigLegacy`

#### 5.2 Remove Feature Flag

- Remove feature flag checks
- Clean up V2 suffix from function names

#### 5.3 Update Documentation

- Update API documentation
- Update developer docs

**Deliverables:**
- [ ] Legacy code removed
- [ ] Feature flag removed
- [ ] Documentation updated
- [ ] PR for cleanup

**Estimated Effort:** 1 day

---

## Timeline Summary

| Phase | Duration | Risk | Dependencies |
|-------|----------|------|--------------|
| Phase 1: Foundation | 1-2 days | Low | None |
| Phase 2: Feature Flag | 0.5 days | Low | Phase 1 |
| Phase 3: Integration Testing | 2-3 days | Medium | Phase 2, Backend PR merged |
| Phase 4: Gradual Rollout | 1-2 weeks | Low | Phase 3 |
| Phase 5: Cleanup | 1 day | Low | Phase 4 complete |

**Total Implementation Time:** ~5-7 days
**Total Rollout Time:** ~2-3 weeks

---

## Rollback Plan

If issues are discovered after deployment:

1. **Immediate:** Set feature flag to `false`
2. **Short-term:** Deploy hotfix to disable new endpoints
3. **Investigation:** Analyze issues with new endpoints
4. **Resolution:** Fix and re-test before re-enabling

---

## Open Questions

1. **Output Schema Generation:** Should the frontend generate output schemas when creating evaluators, or should the backend handle this?
   - Current PR shows backend generates schemas during migration
   - Frontend may need to include schema for new configs

2. **Slug Generation:** Should slugs be generated client-side or server-side?
   - Server-side is safer (uniqueness checks)
   - Client-side is faster (no round-trip)

3. **Error Handling:** How should the frontend handle validation errors from new endpoints?
   - New endpoints may return different error shapes
   - Need to map to user-friendly messages
