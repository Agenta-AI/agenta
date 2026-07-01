/**
 * Evaluator Utilities for Workflow Store
 *
 * Convenience atoms for evaluator-type workflows.
 * Evaluators are workflows with `flags.is_evaluator === true`.
 *
 * Provides:
 * - Evaluator-filtered list query atoms
 * - Template definitions query & key map
 * - Selection config for 1-level evaluator picker
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {dereferenceSchema} from "@agenta/shared/utils"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import type {ListQueryState} from "../../shared"
import {generateLocalId} from "../../shared"
import {queryWorkflows, createWorkflow, updateWorkflow} from "../api"
import {inspectWorkflow} from "../api"
import type {EvaluatorCatalogPresetsResponse} from "../api/templates"
import {fetchEvaluatorCatalogPresets} from "../api/templates"
import type {Workflow} from "../core"
import {
    buildWorkflowUri,
    hasFullPagePlaygroundUX,
    isOnlineCapableEvaluator,
    parseWorkflowKeyFromUri,
    resolveOutputSchemaProperties,
} from "../core"

import {evaluatorTemplatesDataAtom} from "./evaluatorTemplateAtoms"
import {buildServiceUrlFromUri, filterLlmEvaluatorWorkflows} from "./helpers"
import {
    workflowProjectIdAtom,
    workflowLocalServerDataAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    workflowEntityAtomFamily,
    invalidateWorkflowsListCache,
    type WorkflowListRef,
    toWorkflowListRef,
} from "./store"

// Re-export template atoms from the leaf module so existing callers keep working.
// The leaf module has no store dependency, so store.ts can import it directly.
export {
    evaluatorTemplatesQueryAtom,
    evaluatorTemplatesDataAtom,
    evaluatorTemplatesMapAtom,
    evaluatorTemplateByKeyAtomFamily,
} from "./evaluatorTemplateAtoms"

// ============================================================================
// EVALUATOR-FILTERED LIST QUERY
// ============================================================================

/**
 * Thin list response cached in TanStack Query for evaluators.
 */
interface WorkflowListRefsResponse {
    count: number
    refs: WorkflowListRef[]
}

/**
 * Query atom for evaluator-type workflows only.
 * Calls `queryWorkflows` with `flags: { is_evaluator: true }`.
 *
 * Caches only thin references in TanStack Query.
 * staleTime: 0 ensures cross-page consistency — when a component
 * re-subscribes after navigation, the query always verifies freshness.
 */
export const evaluatorsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(workflowProjectIdAtom)
    return {
        queryKey: ["workflows", "evaluators", "list", projectId],
        queryFn: async (): Promise<WorkflowListRefsResponse> => {
            if (!projectId) return {count: 0, refs: []}
            const response = await queryWorkflows({projectId, flags: {is_evaluator: true}})
            const workflows = response.workflows ?? []

            return {
                count: response.count ?? workflows.length,
                refs: workflows.map(toWorkflowListRef),
            }
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Derived atom for evaluator-type workflows list data.
 * Returns workflow-level objects directly from the query cache.
 */
export const evaluatorsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    const refs = query.data?.refs ?? []
    return refs as Workflow[]
})

/**
 * Derived atom for non-archived evaluator-type workflows.
 * Filters by deleted_at on the cached workflow-level refs.
 */
export const nonArchivedEvaluatorsAtom = atom<Workflow[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    const refs = query.data?.refs ?? []
    return refs.filter((ref) => !ref.deleted_at) as Workflow[]
})

/**
 * Non-archived LLM-based evaluators.
 *
 * Evaluator-family flags live on latest revisions rather than the artifact
 * list, so revisions are resolved through the shared batched query atoms.
 * Unresolved evaluators are held back until they can be classified.
 */
export const llmEvaluatorsAtom = atom<Workflow[]>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    const latestRevisions = new Map<string, Workflow>()

    evaluators.forEach((evaluator) => {
        if (!evaluator.id) return
        const revision = get(workflowLatestRevisionQueryAtomFamily(evaluator.id)).data
        if (revision) latestRevisions.set(evaluator.id, revision)
    })

    return filterLlmEvaluatorWorkflows(evaluators, latestRevisions)
})

/**
 * Non-archived evaluators whose latest revision has the full-page playground
 * UX (prompt-authored — `auto_ai_critique` / `llm` — or code-authored —
 * `auto_custom_code_run` / `code`). Declarative classifiers (match,
 * exact_match, contains_*, json_*) and human (`is_feedback`) evaluators are
 * filtered out: they can only be configured via the drawer, so surfacing
 * them in the sidebar workflow switcher routes the user to an app-level
 * destination (/apps/[id]/...) that the route guard then redirects back to
 * /evaluators — visually inconsistent and confusing.
 *
 * Resolves the URI / type flags from each evaluator's latest revision (the
 * workflow LIST response carries no `data.uri`, and `is_llm` / `is_code` /
 * `is_feedback` live on the revision, not the parent artifact). Latest-
 * revision queries are batched + cached by `workflowLatestRevisionQuery`,
 * so calling this per-evaluator inside a single derived atom is cheap.
 *
 * Returns the parent `Workflow` records (same shape as
 * `nonArchivedEvaluatorsAtom`), so callers can use it as a drop-in filter.
 */
export const fullPagePlaygroundEvaluatorsAtom = atom<Workflow[]>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    return evaluators.filter((evaluator) => {
        if (!evaluator.id) return false
        const revisionQuery = get(workflowLatestRevisionQueryAtomFamily(evaluator.id))
        const revision = revisionQuery.data
        if (!revision) return false
        if (revision.flags?.is_feedback) return false
        return hasFullPagePlaygroundUX({
            flags: revision.flags as Record<string, unknown> | null,
            data: revision.data as {uri?: string | null} | null,
            meta: revision.meta as Record<string, unknown> | null,
            slug: revision.slug ?? evaluator.slug ?? null,
        })
    })
})

/**
 * Non-archived **automatic** evaluators — i.e. all evaluators except human
 * (`is_feedback`) ones. Unlike `fullPagePlaygroundEvaluatorsAtom`, this does
 * NOT narrow to evaluators that have a full-page playground, so it includes the
 * declarative classifiers too (exact match, regex, similarity / semantic
 * similarity, json diff, contains json, …). This is the right list for the
 * sidebar workflow switcher, which should surface every automatic evaluator.
 *
 * `is_feedback` lives on the revision (not the parent artifact), so it's
 * resolved from each evaluator's latest revision (batched + cached). An
 * evaluator whose latest revision hasn't resolved yet is held back until it
 * does, so a human evaluator never briefly leaks into the list.
 */
export const nonHumanEvaluatorsAtom = atom<Workflow[]>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    return evaluators.filter((evaluator) => {
        if (!evaluator.id) return false
        const revision = get(workflowLatestRevisionQueryAtomFamily(evaluator.id)).data
        if (!revision) return false
        return !revision.flags?.is_feedback
    })
})

/**
 * Non-archived **non-deterministic** evaluators — automatic evaluators that
 * support online (live) evaluation, i.e. the same set offered by the "create
 * online evaluation" drawer. Human (`is_feedback`) evaluators are excluded, and
 * the rest are narrowed via `isOnlineCapableEvaluator` (custom / code / hook /
 * llm families, with a legacy evaluator-key fallback), so the sidebar workflow
 * switcher surfaces only auto evaluators whose output is non-deterministic (as
 * opposed to deterministic matchers like exact match).
 *
 * The classifying flags / uri live on the latest revision, not the parent
 * artifact, so it's resolved per-evaluator from the batched + cached latest
 * revision. An evaluator whose revision hasn't resolved yet is held back until
 * it can be classified.
 */
export const nonDeterministicEvaluatorsAtom = atom<Workflow[]>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    return evaluators.filter((evaluator) => {
        if (!evaluator.id) return false
        const revision = get(workflowLatestRevisionQueryAtomFamily(evaluator.id)).data
        if (!revision) return false
        // Human evaluators can carry is_custom too, so exclude them explicitly
        // before the capability check — only automatic evaluators qualify.
        if (revision.flags?.is_feedback) return false
        return isOnlineCapableEvaluator({
            flags: revision.flags as Record<string, unknown> | null,
            data: revision.data as {uri?: string | null} | null,
            meta: revision.meta as Record<string, unknown> | null,
            slug: revision.slug ?? evaluator.slug ?? null,
        })
    })
})

/**
 * Invalidate the evaluators list cache.
 * Call after create/update/archive operations on evaluator workflows.
 */
export function invalidateEvaluatorsListCache() {
    const store = getDefaultStore()
    // Two-step invalidation for cross-page consistency with jotai-tanstack-query:
    // 1. Invalidate QueryClient cache so staleTime is bypassed on next observer mount
    // 2. Bump the Jotai atom's refreshAtom so it re-evaluates on next subscription
    try {
        const qc = store.get(queryClientAtom)
        qc.invalidateQueries({queryKey: ["workflows", "evaluators"], exact: false})
        qc.removeQueries({queryKey: ["evaluator-paginated"], exact: false})
        qc.removeQueries({queryKey: ["archived-evaluator-paginated"], exact: false})
    } catch {
        // queryClientAtom may not be initialized yet
    }
    store.set(evaluatorsListQueryAtom)
    // Notify any registered listeners (e.g. paginated store invalidation)
    _evaluatorMutationListeners.forEach((fn) => {
        try {
            fn()
        } catch {
            // ignore listener errors
        }
    })
}

// ============================================================================
// MUTATION LISTENERS
// ============================================================================

/**
 * Registry for callbacks that should fire after evaluator mutations.
 * Used by app-level stores (e.g. evaluatorsPaginatedStore) to refresh
 * without creating a circular dependency from entity → app code.
 */
const _evaluatorMutationListeners = new Set<() => void>()

export function onEvaluatorMutation(listener: () => void): () => void {
    _evaluatorMutationListeners.add(listener)
    return () => {
        _evaluatorMutationListeners.delete(listener)
    }
}

// Template atoms are defined in `./evaluatorTemplateAtoms` (a leaf module so
// `store.ts` can consume them without module-load cycles). They're re-exported
// from this file above for backward compatibility.

// ============================================================================
// EVALUATOR KEY MAP
// ============================================================================

/**
 * Derived atom: workflowId → evaluatorKey.
 *
 * For each non-archived evaluator workflow, reads its latest revision
 * (via `workflowQueryAtomFamily` which batch-fetches automatically),
 * extracts `data.uri`, and parses the evaluator key.
 */
export const evaluatorKeyMapAtom = atom<Map<string, string>>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    const map = new Map<string, string>()

    for (const evaluator of evaluators) {
        if (!evaluator.id) continue

        const revisionQuery = get(workflowLatestRevisionQueryAtomFamily(evaluator.id))
        const revision = revisionQuery.data
        if (!revision) continue

        const uri = revision.data?.uri
        if (!uri) continue

        const key = parseWorkflowKeyFromUri(uri)
        if (key) map.set(evaluator.id, key)
    }

    return map
})

// ============================================================================
// EVALUATOR WORKFLOW META MAP
// ============================================================================

/**
 * Display metadata for an evaluator workflow row in selection UIs.
 */
export interface EvaluatorWorkflowMeta {
    /**
     * Number of revisions, derived from the latest revision's version number.
     * Revisions are sequential and v0 is excluded from pickers, so the latest
     * version number equals the revision count — no full-list fetch needed.
     */
    versionCount: number | null
    /** Workflow-level creation timestamp. */
    createdAt: string | null
    /** Workflow-level last-modified timestamp. */
    updatedAt?: string | null
}

/**
 * Derived atom: workflowId → display metadata (version count + timestamps).
 *
 * Reads the same batched + cached latest-revision queries as `evaluatorKeyMapAtom`,
 * so subscribing to this atom adds no extra requests.
 */
export const evaluatorWorkflowMetaMapAtom = atom<Map<string, EvaluatorWorkflowMeta>>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    const map = new Map<string, EvaluatorWorkflowMeta>()

    for (const evaluator of evaluators) {
        if (!evaluator.id) continue

        const revision = get(workflowLatestRevisionQueryAtomFamily(evaluator.id)).data

        map.set(evaluator.id, {
            versionCount: revision?.version ?? null,
            createdAt: evaluator.created_at ?? null,
            updatedAt: evaluator.updated_at ?? null,
        })
    }

    return map
})

/**
 * Derived atom family: revisionId → parent evaluator workflow's display name.
 *
 * Evaluator revisions are frequently named after their variant (e.g. "default"),
 * so displaying the revision's own `name` is misleading. This resolves the
 * revision's `workflow_id` against the evaluator list and returns the parent
 * workflow's name instead. Returns `null` when the revision's parent isn't an
 * evaluator (e.g. app revisions) so callers can fall back to the revision name.
 */
export const evaluatorNameByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<string | null>((get) => {
        const revision = get(workflowEntityAtomFamily(revisionId))
        const workflowId = revision?.workflow_id
        if (!workflowId) return null
        const evaluator = get(evaluatorsListDataAtom).find((w) => w.id === workflowId)
        return evaluator?.name?.trim() || null
    }),
)

/**
 * Per-evaluator output-metric schema, keyed for the observability annotation/feedback
 * filter. `properties` is the raw `{ metricKey: jsonSchema }` record from the latest
 * revision's output schema.
 */
export interface EvaluatorFeedbackSchema {
    slug: string | null
    name: string | null
    properties: Record<string, unknown>
}

/**
 * Derived atom: every non-archived evaluator paired with its output-metric properties.
 */
export const evaluatorFeedbackSchemasAtom = atom<EvaluatorFeedbackSchema[]>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    const result: EvaluatorFeedbackSchema[] = []

    for (const evaluator of evaluators) {
        if (!evaluator.id) continue

        const revision = get(workflowLatestRevisionQueryAtomFamily(evaluator.id)).data
        if (!revision) continue

        result.push({
            slug: evaluator.slug ?? null,
            name: evaluator.name ?? null,
            properties: resolveOutputSchemaProperties(revision.data) ?? {},
        })
    }

    return result
})

interface EvaluatorRevisionFlags {
    isFeedback: boolean
    isCustom: boolean
    isPending: boolean
    revision: Workflow | null
}

const evaluatorRevisionFlagsMapAtom = atom<Map<string, EvaluatorRevisionFlags>>((get) => {
    const evaluators = get(nonArchivedEvaluatorsAtom)
    const map = new Map<string, EvaluatorRevisionFlags>()

    for (const evaluator of evaluators) {
        if (!evaluator.id) continue

        const revisionQuery = get(workflowLatestRevisionQueryAtomFamily(evaluator.id))
        const revision = revisionQuery.data ?? null
        const revisionFlags = revision?.flags

        map.set(evaluator.id, {
            isFeedback: Boolean(revisionFlags?.is_feedback),
            isCustom: Boolean(revisionFlags?.is_custom),
            isPending: revisionQuery.isPending ?? false,
            revision,
        })
    }

    return map
})

// TEMPLATE LOOKUP moved to `./evaluatorTemplateAtoms` (re-exported above).

// ============================================================================
// CATALOG PRESETS QUERY
// ============================================================================

/**
 * Query atom family for evaluator catalog presets.
 * Fetches presets for a specific template key from the catalog API.
 * Returns presets transformed to `{key, name, values}` shape for PlaygroundConfigSection.
 */
export const evaluatorCatalogPresetsQueryAtomFamily = atomFamily((templateKey: string | null) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["evaluatorCatalogPresets", templateKey, projectId],
            queryFn: async (): Promise<EvaluatorCatalogPresetsResponse> => {
                if (!projectId || !templateKey) return {count: 0, presets: []}
                return fetchEvaluatorCatalogPresets(projectId, templateKey)
            },
            enabled: get(sessionAtom) && !!projectId && !!templateKey,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/**
 * Derived atom family: catalog presets for a template key, transformed to
 * the `{key, name, values}` shape expected by PlaygroundConfigSection.
 */
export const evaluatorPresetsAtomFamily = atomFamily((templateKey: string | null) =>
    atom<{key: string; name: string; values: Record<string, unknown>}[]>((get) => {
        if (!templateKey) return []
        const query = get(evaluatorCatalogPresetsQueryAtomFamily(templateKey))
        const presets = query.data?.presets ?? []
        return presets
            .filter((p) => p.key && p.name)
            .map((p) => ({
                key: p.key,
                name: p.name!,
                values: (p.data?.parameters as Record<string, unknown>) ?? {},
            }))
    }),
)

// ============================================================================
// EVALUATOR CONFIGS (non-human, non-custom evaluators)
// ============================================================================

/**
 * Derived atom for evaluator config instances.
 * Filters out human and custom evaluators — returns only "automatic" evaluator workflows.
 */
export const evaluatorConfigsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    const refs = query.data?.refs ?? []
    const revisionFlagsMap = get(evaluatorRevisionFlagsMapAtom)

    const result = refs.filter((ref) => {
        const revisionFlags = ref.id ? revisionFlagsMap.get(ref.id) : undefined
        if (revisionFlags?.isFeedback) return false
        if (revisionFlags?.isCustom) return false
        return true
    }) as Workflow[]

    console.log(
        `[evaluatorConfigsListData] refs=${refs.length}, after filter=${result.length}`,
        `flagsMap size=${revisionFlagsMap.size}`,
    )

    return result
})

/**
 * Latest evaluator revisions for non-human evaluators.
 *
 * The evaluator workflow list only carries workflow-level flags. Evaluator family
 * flags such as `is_custom`, `is_llm`, `is_code`, and `is_hook` live on revisions,
 * and online evaluations must store revision IDs in evaluator steps.
 */
export const evaluatorConfigRevisionsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    const refs = query.data?.refs ?? []
    const revisionFlagsMap = get(evaluatorRevisionFlagsMapAtom)

    return refs
        .map((ref) => {
            if (!ref.id) return null

            const revisionState = revisionFlagsMap.get(ref.id)
            const revision = revisionState?.revision
            if (!revision) return null
            if (revisionState?.isFeedback) return null

            return {
                ...ref,
                ...revision,
                name: revision.name ?? ref.name,
                slug: revision.slug ?? ref.slug,
                description: revision.description ?? ref.description,
                flags: {
                    ...(ref.flags ?? {}),
                    ...(revision.flags ?? {}),
                },
                deleted_at: revision.deleted_at ?? ref.deleted_at,
                created_at: revision.created_at ?? ref.created_at,
                workflow_id: revision.workflow_id ?? ref.id,
            } as Workflow
        })
        .filter((workflow): workflow is Workflow => workflow !== null)
})

/**
 * Query state for evaluator configs list.
 * Provides isPending/isError/refetch for loading indicators.
 */
export const evaluatorConfigsQueryStateAtom = atom<ListQueryState<Workflow>>((get) => {
    const query = get(evaluatorsListQueryAtom)
    const data = get(evaluatorConfigsListDataAtom)
    return {
        data,
        isPending: query.isPending ?? false,
        isError: query.isError ?? false,
        error: query.error ?? null,
    }
})

/**
 * Query state for revision-aware evaluator configs.
 * Includes pending state from latest-revision lookups so consumers do not show
 * an empty evaluator selector while revision flags are still loading.
 */
export const evaluatorConfigRevisionsQueryStateAtom = atom<ListQueryState<Workflow>>((get) => {
    const query = get(evaluatorsListQueryAtom)
    const refs = query.data?.refs ?? []
    const revisionFlagsMap = get(evaluatorRevisionFlagsMapAtom)
    const data = get(evaluatorConfigRevisionsListDataAtom)
    const latestRevisionsPending = refs.some((ref) => {
        if (!ref.id) return false
        return revisionFlagsMap.get(ref.id)?.isPending ?? false
    })

    return {
        data,
        isPending: (query.isPending ?? false) || latestRevisionsPending,
        isError: query.isError ?? false,
        error: query.error ?? null,
    }
})

// ============================================================================
// HUMAN EVALUATORS
// ============================================================================

/**
 * Query atom for human evaluator workflows.
 * Calls `queryWorkflows` with `flags: { is_evaluator: true, is_feedback: true }`.
 *
 * Caches only thin references in TanStack Query.
 */
export const humanEvaluatorsListQueryAtom = atom((get) => {
    const query = get(evaluatorsListQueryAtom)
    const refs = get(humanEvaluatorsListDataAtom)

    return {
        ...query,
        data: {
            count: refs.length,
            refs: refs as WorkflowListRef[],
        },
    }
})

/**
 * Derived atom for human evaluator workflows list data.
 * Returns workflow-level objects directly from the query cache.
 */
export const humanEvaluatorsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    const refs = query.data?.refs ?? []
    const revisionFlagsMap = get(evaluatorRevisionFlagsMapAtom)

    return refs.filter((ref) => {
        const revisionFlags = ref.id ? revisionFlagsMap.get(ref.id) : undefined
        return Boolean(revisionFlags?.isFeedback)
    }) as Workflow[]
})

// ============================================================================
// CREATE FROM TEMPLATE
// ============================================================================

/**
 * Extract default values from a settings_template.
 *
 * settings_template stores metadata-wrapped values like:
 *   { prompt_template: { label: "...", type: "messages", default: [...] }, model: { default: "gpt-4o", ... } }
 *
 * The backend returns flat parameter values like:
 *   { prompt_template: [...], model: "gpt-4o" }
 *
 * This function converts from template format to flat values.
 */
function extractDefaultValues(settingsTemplate: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(settingsTemplate)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const meta = value as Record<string, unknown>
            if ("default" in meta) {
                result[key] = meta.default
            } else if (meta.type !== "hidden") {
                // No default → include key with null so the field appears in the UI
                result[key] = null
            }
        } else {
            result[key] = value
        }
    }
    return result
}

/**
 * Convert a settings_template to a JSON Schema for SchemaPropertyRenderer.
 *
 * Template fields have metadata like:
 *   { label: "...", type: "code"|"boolean"|"multiple_choice"|"string"|"hidden", options?: [...], ... }
 *
 * The playground's SchemaPropertyRenderer uses JSON Schema properties:
 *   - type: "string"|"boolean"|"number"|"object"
 *   - enum: [...] for dropdowns
 *   - x-parameters: {code: true} for code editors
 *   - title: display label
 */
function settingsTemplateToJsonSchema(
    settingsTemplate: Record<string, unknown>,
): Record<string, unknown> {
    const properties: Record<string, Record<string, unknown>> = {}

    for (const [key, value] of Object.entries(settingsTemplate)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        const meta = value as Record<string, unknown>
        const templateType = meta.type as string | undefined

        if (templateType === "hidden") continue

        const prop: Record<string, unknown> = {
            title: (meta.label as string) ?? key,
        }
        if (meta.description) {
            prop.description = meta.description
        }

        switch (templateType) {
            case "code":
                prop.type = "string"
                prop["x-parameters"] = {code: true}
                break
            case "boolean":
                prop.type = "boolean"
                break
            case "multiple_choice":
                prop.type = "string"
                if (Array.isArray(meta.options)) {
                    prop.enum = meta.options
                }
                break
            case "number":
            case "integer":
            case "float":
                prop.type = "number"
                if (meta.min !== undefined) prop.minimum = meta.min
                if (meta.max !== undefined) prop.maximum = meta.max
                break
            case "object":
                prop.type = "object"
                break
            case "messages":
                prop.type = "array"
                break
            case "fields_tags_editor":
                prop.type = "array"
                prop.items = {type: "string"}
                prop["x-parameter"] = "fields_tags_editor"
                break
            default:
                prop.type = "string"
                break
        }

        if (meta["x-ag-ui-advanced"] === true || meta.advanced === true) {
            prop["x-advanced"] = true
        }

        properties[key] = prop
    }

    return {
        type: "object",
        properties,
    }
}

/**
 * Collect the set of keys marked as hidden in the raw settings_template.
 * Used to exclude hidden fields from the merged schema even when the
 * inspect endpoint returns them as visible properties.
 */
function collectHiddenKeys(settingsTemplate: Record<string, unknown>): Set<string> {
    const hidden = new Set<string>()
    for (const [key, value] of Object.entries(settingsTemplate)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        const meta = value as Record<string, unknown>
        if (meta.type === "hidden") {
            hidden.add(key)
        }
    }
    return hidden
}

/**
 * Merge inspect-resolved schemas with template-derived UI hints.
 *
 * The inspect endpoint returns a JSON schema but may be missing fields from the
 * settings_template and lacks UI hints (e.g., x-parameters: {code: true}).
 * Template hints take priority, inspect provides base structure.
 *
 * Fields marked as `type: "hidden"` in the original settings_template are
 * excluded from the merged result, even if the inspect endpoint includes them.
 */
function mergeParameterSchemas(
    inspectSchema: Record<string, unknown> | null,
    templateSchema: Record<string, unknown>,
    hiddenKeys?: Set<string>,
): Record<string, unknown> {
    const templateProps =
        (templateSchema.properties as Record<string, Record<string, unknown>>) ?? {}

    if (!inspectSchema) return templateSchema

    const inspectProps =
        ((inspectSchema as Record<string, unknown>).properties as Record<
            string,
            Record<string, unknown>
        >) ?? {}

    const mergedProps: Record<string, Record<string, unknown>> = {}
    const allKeys = new Set([...Object.keys(inspectProps), ...Object.keys(templateProps)])

    for (const key of allKeys) {
        // Skip fields that the template explicitly marks as hidden
        if (hiddenKeys?.has(key)) continue

        const inspectProp = inspectProps[key]
        const templateProp = templateProps[key]
        if (inspectProp && templateProp) {
            mergedProps[key] = {
                ...inspectProp,
                ...templateProp,
                description: templateProp.description ?? inspectProp.description ?? undefined,
            }
        } else {
            mergedProps[key] = templateProp ?? inspectProp
        }
    }

    return {
        ...(inspectSchema as Record<string, unknown>),
        properties: mergedProps,
    }
}

/**
 * Dereference $ref pointers in catalog schemas.
 * Catalog schemas may use JSON Schema `$defs` + `$ref` (e.g., the `llm`
 * template has `$ref: "#/$defs/message"`). These must be resolved before
 * the UI can render them.
 */
async function derefCatalogSchemas(
    schemas: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {}
    for (const [key, schema] of Object.entries(schemas)) {
        if (schema && typeof schema === "object" && !Array.isArray(schema)) {
            try {
                const {schema: resolved} = await dereferenceSchema(
                    schema as Record<string, unknown>,
                )
                result[key] = resolved ?? schema
            } catch {
                result[key] = schema
            }
        } else {
            result[key] = schema
        }
    }
    return result
}

/**
 * Create a local-only evaluator workflow entity from a template key.
 *
 * Fetches the parameter schema via the inspect endpoint, merges it with
 * template UI hints, and stores the entity in the local atom family.
 * The entity is immediately available via `workflowEntityAtomFamily(id)`.
 *
 * This is a pure entity lifecycle function — no UI/router dependencies.
 *
 * @param templateKey - The evaluator template key (e.g., "auto_exact_match")
 * @returns The local entity ID, or null if the template was not found
 */
export async function createEvaluatorFromTemplate(templateKey: string): Promise<string | null> {
    const store = getDefaultStore()
    const templates = store.get(evaluatorTemplatesDataAtom)
    const template = templates.find((t) => t.key === templateKey)
    const projectId = store.get(projectIdAtom)

    if (!template || !projectId) {
        return null
    }

    // Catalog provides uri directly; fall back to building it from the key
    const uri = template.data?.uri ?? buildWorkflowUri(template.key)
    const localId = generateLocalId("local")

    // Catalog provides schemas under data.schemas.
    // Dereference $ref pointers — catalog schemas use JSON Schema $defs/$ref
    // (e.g., the llm template has $ref: "#/$defs/message").
    const rawCatalogSchemas = template.data?.schemas
    const catalogSchemas = rawCatalogSchemas
        ? await derefCatalogSchemas(rawCatalogSchemas)
        : undefined
    const parametersTemplate = catalogSchemas?.parameters as Record<string, unknown> | undefined

    // Resolve schemas from the inspect endpoint
    let schemas: {
        inputs?: Record<string, unknown> | null
        outputs?: Record<string, unknown> | null
        parameters?: Record<string, unknown> | null
    } = {
        inputs: (catalogSchemas?.inputs as Record<string, unknown> | undefined) ?? null,
        outputs: (catalogSchemas?.outputs as Record<string, unknown> | undefined) ?? null,
        parameters: (catalogSchemas?.parameters as Record<string, unknown> | undefined) ?? null,
    }

    try {
        const serviceUrl = buildServiceUrlFromUri(uri)
        const inspectData = await inspectWorkflow(uri, projectId, serviceUrl)
        const inspectSchemas = inspectData?.revision?.data?.schemas
        if (inspectSchemas) {
            schemas = {
                inputs: inspectSchemas.inputs ?? null,
                outputs: inspectSchemas.outputs ?? schemas.outputs,
                parameters: inspectSchemas.parameters ?? null,
            }
        }
    } catch {
        // If inspect fails, proceed without schemas — template fallback below
    }

    // Determine if the catalog schema is proper JSON Schema or legacy settings_template.
    // JSON Schema has `type: "object"` with `properties` containing sub-schemas.
    // Settings_template has metadata like `{prompt_template: {type: "messages", label: "..."}}`.
    const isJsonSchema =
        parametersTemplate?.type === "object" && typeof parametersTemplate?.properties === "object"

    let parameters: Record<string, unknown> = {
        ...((template.data?.parameters as Record<string, unknown> | undefined) ?? {}),
    }

    if (isJsonSchema) {
        // Canonical JSON Schema — use as-is for UI rendering.
        // Use explicit catalog parameters as the default preset, then fall back
        // to property defaults or null placeholders for fields with no value yet.
        schemas.parameters = parametersTemplate

        const props = parametersTemplate!.properties as Record<string, Record<string, unknown>>
        for (const [key, prop] of Object.entries(props)) {
            // Hidden fields are managed internally and must not appear in the
            // form, but they still need to round-trip through `data.parameters`
            // on save/run. The render path filters them out at nest-time
            // (`nestEvaluatorConfiguration` in `evaluatorTransforms.ts`), so
            // keep any catalog-supplied value in the flat source instead of
            // stripping it.
            const agType = prop?.["x-ag-type"] as string | undefined
            if (agType === "hidden") continue
            if (!(key in parameters)) {
                if (prop?.default !== undefined) {
                    parameters[key] = prop.default
                } else if (prop?.type === "array") {
                    parameters[key] = []
                } else {
                    parameters[key] = null
                }
            }
        }
    } else if (parametersTemplate) {
        // Legacy settings_template — convert to JSON Schema and extract defaults
        const hiddenKeys = collectHiddenKeys(parametersTemplate)
        const templateSchema = settingsTemplateToJsonSchema(parametersTemplate)
        schemas.parameters = mergeParameterSchemas(
            schemas.parameters as Record<string, unknown> | null,
            templateSchema,
            hiddenKeys,
        )
        // Hidden defaults stay in the flat source for round-tripping; the
        // render path drops them via `nestEvaluatorConfiguration`'s schema
        // allowlist.
        parameters = {
            ...extractDefaultValues(parametersTemplate),
            ...parameters,
        }
    }

    // New LLM-as-a-judge defaults to the `mustache` prompt format. Curly is
    // legacy and hidden from the picker for new prompts, so a fresh judge
    // should not start on it (Mahmoud QA 2026-06-03). Only seed when:
    //   - the evaluator is LLM-based (flat params carry a `prompt_template`
    //     messages array — non-LLM evaluators like exact-match have no prompt)
    //   - the catalog template didn't already specify a format.
    // Stored at the flat level; `nestEvaluatorConfiguration` surfaces it into
    // `prompt.template_format` for the picker, and `flattenEvaluatorConfiguration`
    // round-trips it back on commit.
    if (
        Array.isArray(parameters.prompt_template) &&
        typeof parameters.template_format !== "string"
    ) {
        parameters.template_format = "mustache"
    }

    const workflow: Workflow = {
        id: localId,
        name: template.name,
        slug: template.key,
        version: null,
        flags: {
            is_managed: false,
            is_custom: false,
            is_llm: false,
            is_hook: false,
            is_code: false,
            is_match: false,
            is_feedback: false,
            is_agent: false,
            is_skill: false,
            is_chat: false,
            has_url: false,
            has_script: false,
            has_handler: false,
            is_static: false,
            is_application: false,
            is_evaluator: true,
            is_snippet: false,
            is_base: false,
        },
        data: {
            uri,
            parameters,
            schemas,
        },
        meta: {
            __ephemeral: true,
        },
    } as Workflow

    store.set(workflowLocalServerDataAtomFamily(localId), workflow)

    return localId
}

// ============================================================================
// HUMAN EVALUATOR CRUD
// ============================================================================

export interface HumanEvaluatorMetric {
    name: string
    type: string
    optional: boolean
    minimum?: number
    maximum?: number
    enum?: string[]
}

export interface CreateHumanEvaluatorParams {
    name: string
    slug: string
    description?: string
    metrics: HumanEvaluatorMetric[]
}

export interface UpdateHumanEvaluatorParams {
    id: string
    /** Variant ID — required for committing a new revision */
    variantId?: string
    name: string
    description?: string
    metrics: HumanEvaluatorMetric[]
    /** Existing meta to preserve */
    meta?: Record<string, unknown>
    /** Existing tags to preserve */
    tags?: string[]
}

/**
 * Build the outputs JSON Schema from human evaluator metric definitions.
 * Converts metric form data into the schema format expected by the workflow API.
 */
export function buildHumanEvaluatorOutputsSchema(metrics: HumanEvaluatorMetric[]): {
    type: string
    properties: Record<string, unknown>
    required: string[]
} {
    const requiredKeys = metrics.filter((m) => !m.optional).map((m) => m.name)

    const properties = metrics.reduce(
        (acc, metric) => {
            const schema: Record<string, unknown> = {}

            if (metric.type === "label") {
                acc[metric.name] = {
                    type: "array",
                    uniqueItems: true,
                    items: {
                        type: "string",
                        enum: metric.enum?.filter(Boolean) ?? [],
                    },
                }
                return acc
            }

            if (metric.type === "class") {
                acc[metric.name] = {
                    anyOf: [
                        {
                            type: ["string"],
                            enum: metric.enum?.filter(Boolean) ?? [],
                        },
                    ],
                }
                return acc
            }

            schema.type = metric.type
            if (metric.minimum !== undefined) schema.minimum = metric.minimum
            if (metric.maximum !== undefined) schema.maximum = metric.maximum
            if (metric.enum) schema.enum = metric.enum.filter(Boolean)

            acc[metric.name] = schema
            return acc
        },
        {} as Record<string, unknown>,
    )

    return {type: "object", properties, required: requiredKeys}
}

/**
 * Write atom: create a human evaluator workflow.
 *
 * Builds the outputs schema from metrics, calls `createWorkflow`, and invalidates cache.
 * Returns the evaluator slug on success.
 */
export const createHumanEvaluatorAtom = atom(
    null,
    async (get, _set, params: CreateHumanEvaluatorParams) => {
        const projectId = get(workflowProjectIdAtom)
        if (!projectId) throw new Error("No project ID available")

        const outputsSchema = buildHumanEvaluatorOutputsSchema(params.metrics)

        await createWorkflow(projectId, {
            slug: params.slug,
            name: params.name,
            description: params.description,
            flags: {is_evaluator: true},
            data: {
                uri: "agenta:custom:feedback:v0",
                schemas: {outputs: outputsSchema},
            },
        })

        invalidateWorkflowsListCache()
        invalidateEvaluatorsListCache()
        return params.slug
    },
)

/**
 * Write atom: update an existing human evaluator workflow.
 *
 * Rebuilds the outputs schema from metrics, calls `updateWorkflow`, and invalidates cache.
 * Returns the evaluator slug on success.
 */
export const updateHumanEvaluatorAtom = atom(
    null,
    async (get, _set, params: UpdateHumanEvaluatorParams) => {
        const projectId = get(workflowProjectIdAtom)
        if (!projectId) throw new Error("No project ID available")

        const outputsSchema = buildHumanEvaluatorOutputsSchema(params.metrics)

        await updateWorkflow(projectId, {
            id: params.id,
            variantId: params.variantId,
            name: params.name,
            description: params.description,
            flags: {is_evaluator: true},
            meta: (params.meta ?? {}) as Record<string, unknown>,
            tags: params.tags,
            data: {
                uri: "agenta:custom:feedback:v0",
                schemas: {outputs: outputsSchema},
            },
        })

        invalidateWorkflowsListCache()
        invalidateEvaluatorsListCache()
        return params.name
    },
)

// ============================================================================
// SELECTION CONFIG
// ============================================================================

/**
 * Selection config for the 1-level evaluator adapter.
 * Used by the entity selection system for simple evaluator pickers.
 * Uses evaluatorConfigsListDataAtom to show only automatic evaluators
 * (excludes human/feedback and custom evaluators).
 */
export const evaluatorSelectionConfig = {
    evaluatorsAtom: evaluatorConfigsListDataAtom,
    evaluatorsQueryAtom: evaluatorConfigsQueryStateAtom,
}

export type EvaluatorSelectionConfig = typeof evaluatorSelectionConfig
