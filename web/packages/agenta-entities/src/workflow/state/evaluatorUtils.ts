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
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {ListQueryState} from "../../shared"
import {generateLocalId} from "../../shared"
import {queryWorkflows, createWorkflow, updateWorkflow} from "../api"
import {inspectWorkflow} from "../api"
import type {EvaluatorTemplate} from "../api/templates"
import {fetchEvaluatorTemplates} from "../api/templates"
import type {Workflow, WorkflowsResponse} from "../core"
import {buildWorkflowUri, parseWorkflowKeyFromUri} from "../core"

import {
    workflowProjectIdAtom,
    workflowLocalServerDataAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    invalidateWorkflowsListCache,
} from "./store"

// ============================================================================
// EVALUATOR-FILTERED LIST QUERY
// ============================================================================

/**
 * Query atom for evaluator-type workflows only.
 * Calls `queryWorkflows` with `flags: { is_evaluator: true }`.
 */
export const evaluatorsListQueryAtom = atomWithQuery((get) => {
    const projectId = get(workflowProjectIdAtom)
    return {
        queryKey: ["workflows", "evaluators", "list", projectId],
        queryFn: async (): Promise<WorkflowsResponse> => {
            if (!projectId) return {count: 0, workflows: []}
            return queryWorkflows({projectId, flags: {is_evaluator: true}})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 30_000,
    }
})

/**
 * Derived atom for evaluator-type workflows list data.
 */
export const evaluatorsListDataAtom = atom<Workflow[]>((get) => {
    const query = get(evaluatorsListQueryAtom)
    return query.data?.workflows ?? []
})

/**
 * Derived atom for non-archived evaluator-type workflows.
 */
export const nonArchivedEvaluatorsAtom = atom<Workflow[]>((get) => {
    const evaluators = get(evaluatorsListDataAtom)
    return evaluators.filter((w) => !w.deleted_at)
})

/**
 * Invalidate the evaluators list cache.
 * Call after create/update/archive operations on evaluator workflows.
 */
export function invalidateEvaluatorsListCache() {
    const store = getDefaultStore()
    const current = store.get(evaluatorsListQueryAtom)
    if (current?.refetch) {
        current.refetch()
    }
}

// ============================================================================
// TEMPLATES QUERY
// ============================================================================

/**
 * Query atom for evaluator template definitions.
 * Templates are static data (built-in evaluator types), cached for 5 minutes.
 */
export const evaluatorTemplatesQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["evaluatorTemplates", projectId],
        queryFn: async (): Promise<{count: number; templates: EvaluatorTemplate[]}> => {
            if (!projectId) return {count: 0, templates: []}
            return fetchEvaluatorTemplates(projectId)
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom for the templates data array.
 */
export const evaluatorTemplatesDataAtom = atom<EvaluatorTemplate[]>((get) => {
    const query = get(evaluatorTemplatesQueryAtom)
    return query.data?.templates ?? []
})

/**
 * Derived atom: evaluator key → display name.
 *
 * Maps template keys to their display names, e.g.:
 * - "auto_exact_match" → "Exact Match"
 * - "auto_ai_critique" → "LLM-as-a-judge"
 */
export const evaluatorTemplatesMapAtom = atom<Map<string, string>>((get) => {
    const templates = get(evaluatorTemplatesDataAtom)
    const map = new Map<string, string>()
    for (const t of templates) {
        if (t.key && t.name) {
            map.set(t.key, t.name)
        }
    }
    return map
})

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
// TEMPLATE LOOKUP
// ============================================================================

/**
 * Atom family to find a template by key.
 * Returns the matching EvaluatorTemplate or null.
 */
export const evaluatorTemplateByKeyAtomFamily = atomFamily((key: string | null) =>
    atom<EvaluatorTemplate | null>((get) => {
        if (!key) return null
        const templates = get(evaluatorTemplatesDataAtom)
        return templates.find((t) => t.key === key) ?? null
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
    const evaluators = get(evaluatorsListDataAtom)
    return evaluators.filter((w) => {
        const flags = w.flags
        if (!flags) return true
        if (flags.is_human) return false
        if (flags.is_custom) return false
        return true
    })
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

// ============================================================================
// HUMAN EVALUATORS
// ============================================================================

/**
 * Derived atom for human evaluator workflows list data.
 * Filters `evaluatorsListDataAtom` by `flags.is_human === true` — no separate HTTP request.
 */
export const humanEvaluatorsListDataAtom = atom<Workflow[]>((get) => {
    const evaluators = get(evaluatorsListDataAtom)
    return evaluators.filter((w) => w.flags?.is_human === true)
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

        if (meta.advanced === true) {
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
 * Merge inspect-resolved schemas with template-derived UI hints.
 *
 * The inspect endpoint returns a JSON schema but may be missing fields from the
 * settings_template and lacks UI hints (e.g., x-parameters: {code: true}).
 * Template hints take priority, inspect provides base structure.
 */
function mergeParameterSchemas(
    inspectSchema: Record<string, unknown> | null,
    templateSchema: Record<string, unknown>,
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

    const uri = buildWorkflowUri(template.key)
    const localId = generateLocalId("local")

    // Resolve schemas from the inspect endpoint
    let schemas: {
        inputs?: Record<string, unknown> | null
        outputs?: Record<string, unknown> | null
        parameters?: Record<string, unknown> | null
    } = {
        inputs: null,
        outputs: template.outputs_schema ?? null,
        parameters: null,
    }

    try {
        const inspectData = await inspectWorkflow(uri, projectId)
        const inspectSchemas = inspectData?.interface?.schemas
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

    // Merge inspect schema with template UI hints
    if (template.settings_template) {
        const templateSchema = settingsTemplateToJsonSchema(
            template.settings_template as Record<string, unknown>,
        )
        schemas.parameters = mergeParameterSchemas(
            schemas.parameters as Record<string, unknown> | null,
            templateSchema,
        )
    }

    // Extract flat default values from template metadata
    const parameters = extractDefaultValues(template.settings_template as Record<string, unknown>)

    const workflow: Workflow = {
        id: localId,
        name: template.name,
        slug: template.key,
        version: null,
        flags: {
            is_custom: false,
            is_evaluator: true,
            is_human: false,
            is_chat: false,
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
    name: string
    description?: string
    metrics: HumanEvaluatorMetric[]
    /** Existing flags to preserve */
    flags?: Record<string, unknown>
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
            description: params.description ?? "",
            flags: {
                is_custom: false,
                is_human: true,
                is_evaluator: true,
                is_chat: false,
                is_base: false,
            },
            data: {schemas: {outputs: outputsSchema}},
        })

        invalidateWorkflowsListCache()
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
            name: params.name,
            description: params.description,
            flags: {
                is_evaluator: true,
                is_chat: false,
                is_base: false,
                ...(params.flags ?? {}),
                is_human: true,
                is_custom: false,
            },
            meta: (params.meta ?? {}) as Record<string, unknown>,
            tags: params.tags,
            data: {schemas: {outputs: outputsSchema}},
        })

        invalidateWorkflowsListCache()
        return params.name
    },
)

// ============================================================================
// SELECTION CONFIG
// ============================================================================

/**
 * Selection config for the 1-level evaluator adapter.
 * Used by the entity selection system for simple evaluator pickers.
 */
export const evaluatorSelectionConfig = {
    evaluatorsAtom: nonArchivedEvaluatorsAtom,
    evaluatorsQueryAtom: evaluatorsListQueryAtom,
}

export type EvaluatorSelectionConfig = typeof evaluatorSelectionConfig
