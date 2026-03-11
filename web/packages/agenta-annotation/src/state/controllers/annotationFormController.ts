/**
 * Annotation Form Controller
 *
 * State-only controller for annotation form management.
 * Manages evaluator schema resolution, form field state, baseline+edits
 * merging, change detection, and annotation submission.
 *
 * Decoupled from React — usable from tests, callbacks, or any JS context
 * via the imperative `get`/`set` API.
 *
 * Follows the same controller pattern as `annotationSessionController`:
 * - **selectors**: Return atoms for reactive subscriptions
 * - **actions**: Write atoms for state mutations
 * - **get/set**: Imperative API for callbacks outside React
 *
 * @example
 * ```typescript
 * import { annotationFormController } from '@agenta/annotation'
 *
 * // Reactive selectors
 * const metrics = useAtomValue(annotationFormController.selectors.effectiveMetrics('scenario-1'))
 * const dirty = useAtomValue(annotationFormController.selectors.hasPendingChanges('scenario-1'))
 *
 * // Actions
 * const update = useSetAtom(annotationFormController.actions.updateMetric)
 * update({ scenarioId: 'scenario-1', slug: 'relevance', fieldKey: 'score', value: 7 })
 *
 * // Imperative (no React needed)
 * annotationFormController.set.submitAnnotations({ scenarioId: 'scenario-1', queueId: 'q-1' })
 * ```
 *
 * @packageDocumentation
 */

import type {Annotation} from "@agenta/entities/annotation"
import {
    createAnnotation,
    updateAnnotation,
    invalidateAnnotationCacheByLink,
    type CreateAnnotationPayload,
} from "@agenta/entities/annotation"
import {
    evaluationRunMolecule,
    queryEvaluationResults,
    type EvaluationResult,
} from "@agenta/entities/evaluationRun"
import {evaluatorQueryAtomFamily, type Evaluator} from "@agenta/entities/evaluator"
import {invalidateScenarioProgressCache} from "@agenta/entities/simpleQueue"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import deepEqual from "fast-deep-equal"
import {atom, type Getter} from "jotai"
import {atomFamily} from "jotai/utils"
import {getDefaultStore} from "jotai/vanilla"

import type {
    AnnotationMetricField,
    AnnotationMetrics,
    ScenarioContext,
    UpdateMetricPayload,
    SubmitAnnotationsPayload,
} from "../types"

import {annotationSessionController} from "./annotationSessionController"

// ============================================================================
// SCHEMA EXTRACTION HELPERS (pure functions, no React)
// ============================================================================

const USEABLE_METRIC_TYPES = ["number", "integer", "float", "boolean", "string", "array"]

/**
 * Extract the outputs schema from an evaluator entity.
 * Handles both new (`data.schemas.outputs`) and legacy (`data.service.format.properties.outputs`) paths.
 */
export function getOutputsSchema(evaluator: Evaluator): {
    properties?: Record<string, unknown>
    required?: string[]
} {
    const schemaOutputs = evaluator.data?.schemas?.outputs
    if (schemaOutputs && typeof schemaOutputs === "object") {
        return schemaOutputs as {properties?: Record<string, unknown>; required?: string[]}
    }
    const legacyOutputs = (evaluator.data as Record<string, unknown>)?.service
    if (legacyOutputs && typeof legacyOutputs === "object") {
        const format = (legacyOutputs as Record<string, unknown>)?.format
        if (format && typeof format === "object") {
            const props = (format as Record<string, unknown>)?.properties
            if (props && typeof props === "object") {
                const outputs = (props as Record<string, unknown>)?.outputs
                if (outputs && typeof outputs === "object") {
                    return outputs as {
                        properties?: Record<string, unknown>
                        required?: string[]
                    }
                }
            }
        }
    }
    return {}
}

/**
 * Derive empty form fields from an evaluator's output schema.
 */
export function getMetricFieldsFromEvaluator(
    evaluator: Evaluator,
): Record<string, AnnotationMetricField> {
    const schema = getOutputsSchema(evaluator)?.properties ?? {}
    const fields: Record<string, AnnotationMetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const rawType = propObj?.type as string | string[] | undefined

        if (!rawType) continue

        if (Array.isArray(rawType)) {
            const enumValues =
                (propObj.enum as unknown[] | undefined)?.filter(
                    (value) => value !== null && value !== undefined && value !== "",
                ) || []
            const filteredTypes = rawType.filter((value) => value !== "null")
            if (filteredTypes.length === 0) continue
            const baseType = filteredTypes[0]
            fields[key] = {
                value: baseType === "string" ? "" : null,
                type: filteredTypes,
                enum: enumValues,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
            continue
        }

        const type = rawType

        if (type === "array") {
            const items = propObj.items as Record<string, unknown> | undefined
            fields[key] = {
                value: [],
                type: "array",
                items: {
                    type: (typeof items?.type === "string" ? items.type : "string") as string,
                    enum: (items?.enum as string[] | undefined) ?? [],
                },
            }
        } else if (USEABLE_METRIC_TYPES.includes(type)) {
            fields[key] = {
                value: type === "string" ? "" : null,
                type,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
        }
    }

    return fields
}

/**
 * Derive form fields from an existing annotation, filling values from outputs.
 */
export function getMetricsFromAnnotation(
    annotation: Annotation,
    evaluator: Evaluator,
): Record<string, AnnotationMetricField> {
    const schema = getOutputsSchema(evaluator)?.properties ?? {}
    const rawOutputs = (annotation.data?.outputs as Record<string, unknown>) ?? {}

    // Flatten nested structures
    const outputs: Record<string, unknown> = {}
    if (rawOutputs.metrics && typeof rawOutputs.metrics === "object") {
        Object.assign(outputs, rawOutputs.metrics)
    }
    if (rawOutputs.notes && typeof rawOutputs.notes === "object") {
        Object.assign(outputs, rawOutputs.notes)
    }
    if (rawOutputs.extra && typeof rawOutputs.extra === "object") {
        Object.assign(outputs, rawOutputs.extra)
    }
    for (const [k, v] of Object.entries(rawOutputs)) {
        if (k !== "metrics" && k !== "notes" && k !== "extra") {
            outputs[k] = v
        }
    }

    if (!Object.keys(schema).length) {
        return inferFieldsFromOutputs(outputs)
    }

    const fields: Record<string, AnnotationMetricField> = {}

    for (const [key, rawProp] of Object.entries(schema)) {
        if (!rawProp || typeof rawProp !== "object") continue

        const prop = (rawProp as Record<string, unknown>).anyOf
            ? ((rawProp as Record<string, unknown>).anyOf as unknown[])[0]
            : rawProp
        const propObj = prop as Record<string, unknown>
        const rawType = propObj?.type as string | string[] | undefined

        if (!rawType) continue

        const hasValue = key in outputs
        const value = hasValue ? outputs[key] : undefined

        if (Array.isArray(rawType)) {
            const enumValues =
                (propObj.enum as unknown[] | undefined)?.filter(
                    (item) => item !== null && item !== undefined && item !== "",
                ) || []
            const filteredTypes = rawType.filter((item) => item !== "null")
            if (filteredTypes.length === 0) continue
            const baseType = filteredTypes[0]
            const defaultValue = baseType === "string" ? "" : null
            fields[key] = {
                value: hasValue ? value : defaultValue,
                type: filteredTypes,
                enum: enumValues,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
            continue
        }

        const type = rawType

        if (type === "array") {
            const items = propObj.items as Record<string, unknown> | undefined
            fields[key] = {
                value: value ?? [],
                type: "array",
                items: {
                    type: (typeof items?.type === "string" ? items.type : "string") as string,
                    enum: (items?.enum as string[] | undefined) ?? [],
                },
            }
        } else if (USEABLE_METRIC_TYPES.includes(type)) {
            const defaultValue = type === "string" ? "" : null
            fields[key] = {
                value: hasValue ? value : defaultValue,
                type,
                minimum: propObj.minimum as number | undefined,
                maximum: propObj.maximum as number | undefined,
            }
        }
    }

    return fields
}

function inferFieldType(value: unknown): AnnotationMetricField | null {
    if (value === null || value === undefined) {
        return {value: null, type: "string"}
    }
    if (typeof value === "boolean") {
        return {value, type: "boolean"}
    }
    if (typeof value === "number") {
        return {value, type: Number.isInteger(value) ? "integer" : "number"}
    }
    if (typeof value === "string") {
        return {value, type: "string"}
    }
    if (Array.isArray(value)) {
        const sample = value.find((entry) => entry !== null && entry !== undefined)
        const itemType =
            typeof sample === "boolean"
                ? "boolean"
                : typeof sample === "number"
                  ? Number.isInteger(sample)
                      ? "integer"
                      : "number"
                  : "string"
        return {
            value,
            type: "array",
            items: {type: itemType, enum: []},
        }
    }
    if (typeof value === "object") {
        return {value: JSON.stringify(value), type: "string"}
    }
    return null
}

function inferFieldsFromOutputs(outputs: Record<string, unknown>) {
    const fields: Record<string, AnnotationMetricField> = {}
    for (const [key, value] of Object.entries(outputs)) {
        const field = inferFieldType(value)
        if (!field) continue
        fields[key] = field
    }
    return fields
}

export function isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined || value === "") return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
}

function isEmptyMetrics(fields: Record<string, {value: unknown}>): boolean {
    return Object.values(fields).every(
        (f) =>
            f.value === null ||
            f.value === undefined ||
            f.value === "" ||
            (Array.isArray(f.value) && f.value.length === 0),
    )
}

async function patchScenarioStatus(projectId: string, scenarioId: string, status: string) {
    await axios.patch(
        `${getAgentaApiUrl()}/preview/evaluations/scenarios/`,
        {
            scenarios: [{id: scenarioId, status}],
        },
        {
            params: {project_id: projectId},
        },
    )
}

/**
 * Convert a hex string (32 chars) to UUID format (with dashes).
 */
function hexToUuid(hex: string): string {
    if (hex.includes("-")) return hex
    if (hex.length !== 32) return hex
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Convert a hex span ID (16 chars) to UUID format by doubling it.
 */
function spanHexToUuid(hex: string): string {
    if (hex.includes("-")) return hex
    if (hex.length === 16) {
        const doubled = hex + hex
        return `${doubled.slice(0, 8)}-${doubled.slice(8, 12)}-${doubled.slice(12, 16)}-${doubled.slice(16, 20)}-${doubled.slice(20)}`
    }
    if (hex.length === 32) {
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
    return hex
}

/**
 * Upsert a step result linking an annotation to the evaluation run.
 * Queries existing results for the step key, then patches or creates.
 */
async function upsertStepResultWithAnnotation({
    projectId,
    runId,
    scenarioId,
    stepKey,
    annotationTraceId,
    annotationSpanId,
}: {
    projectId: string
    runId: string
    scenarioId: string
    stepKey: string
    annotationTraceId: string
    annotationSpanId: string
}) {
    const apiUrl = getAgentaApiUrl()
    const traceIdUuid = hexToUuid(annotationTraceId)
    const spanIdUuid = spanHexToUuid(annotationSpanId)

    // Query for existing step result
    let existingResult: EvaluationResult | null = null
    try {
        const results = await queryEvaluationResults({
            projectId,
            runId,
            scenarioIds: [scenarioId],
            stepKeys: [stepKey],
        })
        existingResult = results.find((r) => r.step_key === stepKey) ?? null
    } catch {
        // Ignore query errors
    }

    if (existingResult?.id) {
        await axios.patch(
            `${apiUrl}/preview/evaluations/results/`,
            {
                results: [
                    {
                        id: existingResult.id,
                        status: "success",
                        trace_id: traceIdUuid,
                        span_id: spanIdUuid,
                    },
                ],
            },
            {params: {project_id: projectId}},
        )
    } else {
        await axios.post(
            `${apiUrl}/preview/evaluations/results/`,
            {
                results: [
                    {
                        run_id: runId,
                        scenario_id: scenarioId,
                        step_key: stepKey,
                        status: "success",
                        trace_id: traceIdUuid,
                        span_id: spanIdUuid,
                    },
                ],
            },
            {params: {project_id: projectId}},
        )
    }
}

/**
 * Build metric data from an annotation value.
 * Returns the shape expected by the metrics API.
 */
function buildMetricDataFromValue(value: unknown): Record<string, unknown> | null {
    if (typeof value === "boolean") {
        return {
            type: "binary",
            count: 1,
            freq: [
                {value: true, count: value ? 1 : 0, density: value ? 1 : 0},
                {value: false, count: value ? 0 : 1, density: value ? 0 : 1},
            ],
            uniq: [true, false],
        }
    }
    if (Array.isArray(value)) {
        const uniqueValues = [...new Set(value as string[])]
        const freq = uniqueValues.map((v) => {
            const count = (value as string[]).filter((val) => val === v).length
            return {value: v, count, density: value.length > 0 ? count / value.length : 0}
        })
        return {type: "categorical/multiple", count: 1, freq, uniq: uniqueValues}
    }
    if (typeof value === "string") {
        return {type: "string", count: 1}
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return {
            type: "numeric/continuous",
            count: 1,
            max: value,
            min: value,
            sum: value,
            mean: value,
            range: 0,
        }
    }
    return null
}

/**
 * Build and upsert scenario metrics from annotation outputs.
 * Converts annotation outputs to metric format and saves via the metrics API.
 */
async function upsertAnnotationMetrics({
    projectId,
    runId,
    scenarioId,
    outputs,
    stepKey,
}: {
    projectId: string
    runId: string
    scenarioId: string
    outputs: Record<string, unknown>
    stepKey: string
}) {
    const apiUrl = getAgentaApiUrl()

    // Build metric data for each output key
    const metricsForStep: Record<string, unknown> = {}
    for (const [metricName, value] of Object.entries(outputs)) {
        if (value === null || value === undefined) continue
        const metricData = buildMetricDataFromValue(value)
        if (!metricData) continue
        metricsForStep[`attributes.ag.data.outputs.${metricName}`] = metricData
    }

    if (Object.keys(metricsForStep).length === 0) return

    const data = {[stepKey]: metricsForStep}

    // Query existing metrics for this scenario
    let existingMetric: {id?: string; data?: Record<string, unknown>; status?: string} | null = null
    try {
        const queryResponse = await axios.post(
            `${apiUrl}/preview/evaluations/metrics/query`,
            {
                metrics: {run_ids: [runId], scenario_ids: [scenarioId]},
                windowing: {},
            },
            {params: {project_id: projectId}},
        )
        const existingMetrics = Array.isArray(queryResponse?.data?.metrics)
            ? queryResponse.data.metrics
            : []
        existingMetric =
            existingMetrics.find(
                (m: Record<string, unknown>) => (m?.scenario_id || m?.scenarioId) === scenarioId,
            ) ?? null
    } catch {
        // Ignore query errors
    }

    // Merge with existing data
    const mergedData = {...(existingMetric?.data || {}), ...data}

    if (existingMetric?.id) {
        await axios.patch(
            `${apiUrl}/preview/evaluations/metrics/`,
            {
                metrics: [
                    {
                        id: existingMetric.id,
                        data: mergedData,
                        status: existingMetric.status || "success",
                    },
                ],
            },
            {params: {project_id: projectId}},
        )
    } else {
        await axios.post(
            `${apiUrl}/preview/evaluations/metrics/`,
            {
                metrics: [
                    {
                        run_id: runId,
                        scenario_id: scenarioId,
                        data: mergedData,
                        status: "success",
                    },
                ],
            },
            {params: {project_id: projectId}},
        )
    }
}

/**
 * Check if all scenarios in a run are complete, and if so update the run status.
 */
async function checkAndUpdateRunStatus(projectId: string, runId: string) {
    const apiUrl = getAgentaApiUrl()

    try {
        const scenariosResponse = await axios.post(
            `${apiUrl}/preview/evaluations/scenarios/query`,
            {
                scenario: {run_ids: [runId]},
                windowing: {limit: 1000},
            },
            {params: {project_id: projectId}},
        )

        const scenarios = scenariosResponse.data?.scenarios ?? []
        if (scenarios.length === 0) return

        const terminalStatuses = new Set([
            "success",
            "error",
            "failure",
            "failed",
            "errors",
            "cancelled",
        ])

        const allComplete = scenarios.every((scenario: {status?: string}) =>
            terminalStatuses.has(scenario.status?.toLowerCase() ?? ""),
        )

        if (!allComplete) return

        const hasErrors = scenarios.some((scenario: {status?: string}) => {
            const status = scenario.status?.toLowerCase() ?? ""
            return ["error", "failure", "failed", "errors"].includes(status)
        })

        const newRunStatus = hasErrors ? "errors" : "success"

        // Fetch existing run data to preserve all fields
        const runResponse = await axios.post(
            `${apiUrl}/preview/evaluations/runs/query`,
            {run: {ids: [runId]}},
            {params: {project_id: projectId}},
        )

        const existingRun = runResponse.data?.runs?.[0]
        if (!existingRun) return

        await axios.patch(
            `${apiUrl}/preview/evaluations/runs/${runId}`,
            {run: {...existingRun, id: runId, status: newRunStatus}},
            {params: {project_id: projectId}},
        )
    } catch (error) {
        console.warn("[annotationForm] checkAndUpdateRunStatus failed:", error)
    }
}

// ============================================================================
// BASELINE COMPUTATION (pure function, called by atoms)
// ============================================================================

/**
 * Compute baseline metrics from annotations + evaluator schemas.
 *
 * Accepts a Jotai `get` function for reactive reads — this creates proper
 * subscriptions so derived atoms re-evaluate when evaluator data arrives.
 *
 * NOTE: Uses workflow IDs resolved via `evaluatorQueryAtomFamily` (same path as
 * the queues table EvaluatorNamesCell). This fetches the latest revision by
 * workflow ID, which contains the output schemas needed for form fields.
 */
function computeBaseline(
    get: Getter,
    evaluatorWorkflowIds: string[],
    annotations: Annotation[],
): {baseline: AnnotationMetrics; evaluators: Evaluator[]} {
    // Resolve evaluators reactively by workflow ID — creates subscriptions
    // Uses the same atom family as the queues table (proven working path)
    const evaluators: Evaluator[] = []
    const evaluatorMap = new Map<string, Evaluator>()

    for (const workflowId of evaluatorWorkflowIds) {
        if (!workflowId) continue
        const query = get(evaluatorQueryAtomFamily(workflowId))
        const evalData = query.data ?? null
        if (evalData) {
            evaluators.push(evalData)
            if (evalData.slug) evaluatorMap.set(evalData.slug, evalData)
            if (evalData.id) evaluatorMap.set(evalData.id, evalData)
        }
    }

    const result: AnnotationMetrics = {}

    // Add metrics from existing annotations
    for (const ann of annotations) {
        const evaluatorRef = ann.references?.evaluator
        const evaluatorKey = evaluatorRef?.slug ?? evaluatorRef?.id
        if (!evaluatorKey) continue

        const evaluator = evaluatorMap.get(evaluatorKey)
        if (!evaluator) continue

        const slug = evaluator.slug ?? evaluatorKey
        if (!slug) continue

        result[slug] = getMetricsFromAnnotation(ann, evaluator)
    }

    // Add empty metrics for unannotated evaluators
    const annotatedKeys = new Set(
        annotations
            .flatMap((a) => [a.references?.evaluator?.slug, a.references?.evaluator?.id])
            .filter(Boolean) as string[],
    )
    for (const evaluator of evaluators) {
        const slug = evaluator.slug
        if (!slug) continue
        if (annotatedKeys.has(slug)) continue
        if (evaluator.id && annotatedKeys.has(evaluator.id)) continue
        result[slug] = getMetricFieldsFromEvaluator(evaluator)
    }

    return {baseline: result, evaluators}
}

// ============================================================================
// CORE ATOMS
// ============================================================================

/**
 * Evaluator workflow IDs — derived from session controller.
 * Uses the same resolution path as the queues table (evaluatorIds = workflow/artifact IDs).
 * These are resolved via evaluatorMolecule / evaluatorQueryAtomFamily which fetches
 * the latest revision by workflow ID.
 */
const evaluatorIdsAtom = atom<string[]>((get) =>
    get(annotationSessionController.selectors.evaluatorIds()),
)

/** Annotations per scenario */
const annotationsByScenarioAtomFamily = atomFamily(
    (_scenarioId: string) => atom<Annotation[]>([]),
    (a, b) => a === b,
)

/** Trace/span IDs per scenario */
const traceSpanByScenarioAtomFamily = atomFamily(
    (_scenarioId: string) => atom<{traceId: string; spanId: string}>({traceId: "", spanId: ""}),
    (a, b) => a === b,
)

/** User edits per scenario (local changes not yet submitted) */
const editsAtomFamily = atomFamily(
    (_scenarioId: string) => atom<AnnotationMetrics>({}),
    (a, b) => a === b,
)

/** Submission state per scenario */
const isSubmittingAtomFamily = atomFamily(
    (_scenarioId: string) => atom<boolean>(false),
    (a, b) => a === b,
)

// ============================================================================
// DERIVED ATOMS
// ============================================================================

/** Computed baseline from annotations + evaluator schemas */
const baselineAtomFamily = atomFamily(
    (scenarioId: string) =>
        atom((get) => {
            const evalIds = get(evaluatorIdsAtom)
            const annotations = get(annotationsByScenarioAtomFamily(scenarioId))
            return computeBaseline(get, evalIds, annotations)
        }),
    (a, b) => a === b,
)

/** Effective metrics = baseline merged with edits */
const effectiveMetricsAtomFamily = atomFamily(
    (scenarioId: string) =>
        atom((get) => {
            const {baseline} = get(baselineAtomFamily(scenarioId))
            const edits = get(editsAtomFamily(scenarioId))

            if (Object.keys(edits).length === 0) {
                return baseline
            }

            const merged: AnnotationMetrics = {}
            const allSlugs = new Set([...Object.keys(baseline), ...Object.keys(edits)])

            for (const slug of allSlugs) {
                const baselineFields = baseline[slug] ?? {}
                const editFields = edits[slug] ?? {}
                merged[slug] = {...baselineFields, ...editFields}
            }

            return merged
        }),
    (a, b) => a === b,
)

/** Whether there are unsaved changes */
const hasPendingChangesAtomFamily = atomFamily(
    (scenarioId: string) =>
        atom((get) => {
            const edits = get(editsAtomFamily(scenarioId))
            if (Object.keys(edits).length === 0) return false

            const {baseline} = get(baselineAtomFamily(scenarioId))

            for (const [slug, fields] of Object.entries(edits)) {
                const baselineSlug = baseline[slug] ?? {}
                for (const [key, field] of Object.entries(fields)) {
                    const baselineField = baselineSlug[key]
                    const currentValue = field.value
                    const baselineValue = baselineField?.value

                    if (!deepEqual(currentValue, baselineValue)) {
                        const isCurrentEmpty = isEmptyValue(currentValue)
                        const isBaselineEmpty = isEmptyValue(baselineValue)

                        if (!isCurrentEmpty || !isBaselineEmpty) {
                            return true
                        }
                    }
                }
            }
            return false
        }),
    (a, b) => a === b,
)

/** Resolved evaluators for the current session */
const evaluatorsAtomFamily = atomFamily(
    (scenarioId: string) =>
        atom((get) => {
            const {evaluators} = get(baselineAtomFamily(scenarioId))
            return evaluators
        }),
    (a, b) => a === b,
)

// ============================================================================
// ACTION ATOMS
// ============================================================================

/** Set annotations and trace/span for a scenario */
const setScenarioContextAtom = atom(null, (get, set, ctx: ScenarioContext) => {
    const prevAnnotations = get(annotationsByScenarioAtomFamily(ctx.scenarioId))
    set(annotationsByScenarioAtomFamily(ctx.scenarioId), ctx.annotations)
    set(traceSpanByScenarioAtomFamily(ctx.scenarioId), {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
    })

    // If annotations changed (e.g. after save + refetch), clear matching edits
    if (prevAnnotations !== ctx.annotations && prevAnnotations.length > 0) {
        const edits = get(editsAtomFamily(ctx.scenarioId))
        if (Object.keys(edits).length > 0) {
            const {baseline} = computeBaseline(get, get(evaluatorIdsAtom), ctx.annotations)
            const remainingEdits: AnnotationMetrics = {}
            let hasRemaining = false

            for (const [slug, fields] of Object.entries(edits)) {
                const baselineSlug = baseline[slug] ?? {}
                const remainingFields: Record<string, AnnotationMetricField> = {}
                let hasFields = false

                for (const [key, field] of Object.entries(fields)) {
                    const baselineField = baselineSlug[key]
                    if (!deepEqual(field.value, baselineField?.value)) {
                        remainingFields[key] = field
                        hasFields = true
                    }
                }

                if (hasFields) {
                    remainingEdits[slug] = remainingFields
                    hasRemaining = true
                }
            }

            set(editsAtomFamily(ctx.scenarioId), hasRemaining ? remainingEdits : {})
        }
    }
})

/** Update a single metric field */
const updateMetricAtom = atom(null, (get, set, payload: UpdateMetricPayload) => {
    const {scenarioId, slug, fieldKey, value} = payload
    const edits = get(editsAtomFamily(scenarioId))
    const {baseline} = get(baselineAtomFamily(scenarioId))

    const baselineField = baseline[slug]?.[fieldKey] ?? {}
    const currentField = edits[slug]?.[fieldKey] ?? baselineField

    set(editsAtomFamily(scenarioId), {
        ...edits,
        [slug]: {
            ...edits[slug],
            [fieldKey]: {
                ...currentField,
                value,
            },
        },
    })
})

/** Reset edits for a scenario */
const resetEditsAtom = atom(null, (_get, set, scenarioId: string) => {
    set(editsAtomFamily(scenarioId), {})
})

/** Submit annotations and optionally mark scenario complete */
const submitAnnotationsAtom = atom(null, async (get, set, payload: SubmitAnnotationsPayload) => {
    const {scenarioId, queueId, markComplete} = payload
    const rawProjectId = get(projectIdAtom)
    const traceSpan = get(traceSpanByScenarioAtomFamily(scenarioId))

    if (!rawProjectId || !traceSpan.traceId) {
        throw new Error("Missing project or trace ID")
    }

    const projectId: string = rawProjectId
    const traceId: string = traceSpan.traceId
    const spanId: string = traceSpan.spanId

    set(isSubmittingAtomFamily(scenarioId), true)

    try {
        const metrics = get(effectiveMetricsAtomFamily(scenarioId))
        const evalIds = get(evaluatorIdsAtom)

        // Get existing annotations from the session controller's cache.
        // These were fetched using annotation step trace_ids (the correct path).
        // Fall back to empty array if not yet loaded.
        const existingAnnotations =
            annotationSessionController.get.scenarioAnnotations(scenarioId) ?? []

        // Build evaluator slug → evaluator map (evalIds are workflow IDs).
        // IMPORTANT: evaluatorQueryAtomFamily returns revision data where `evaluator.id`
        // is the REVISION ID, not the workflow/artifact ID. The backend expects the
        // workflow ID in annotation references. Track both mappings.
        const evaluatorMap = new Map<string, Evaluator>()
        const workflowIdBySlug = new Map<string, string>()
        for (const workflowId of evalIds) {
            const query = get(evaluatorQueryAtomFamily(workflowId))
            const evalData = query.data ?? null
            if (evalData) {
                if (evalData.slug) {
                    evaluatorMap.set(evalData.slug, evalData)
                    workflowIdBySlug.set(evalData.slug, workflowId)
                }
                if (evalData.id) evaluatorMap.set(evalData.id, evalData)
            }
        }

        // Build evaluator slug → annotation step references map.
        // Annotation steps contain evaluator_revision and evaluator_variant refs
        // that are needed for the backend to find existing evaluators (avoids
        // SimpleEvaluator slug conflicts).
        const activeRunId = annotationSessionController.get.activeRunId()
        const annotationSteps = activeRunId
            ? getStore().get(evaluationRunMolecule.selectors.annotationSteps(activeRunId))
            : []
        const stepRefsByEvalId = new Map<
            string,
            {
                evaluator_revision?: {id?: string; slug?: string}
                evaluator_variant?: {id?: string; slug?: string}
            }
        >()
        for (const step of annotationSteps) {
            const evalId = step.references?.evaluator?.id
            if (evalId) {
                stepRefsByEvalId.set(evalId, {
                    evaluator_revision: step.references?.evaluator_revision
                        ? {
                              id: step.references.evaluator_revision.id ?? undefined,
                              slug: step.references.evaluator_revision.slug ?? undefined,
                          }
                        : undefined,
                    evaluator_variant: step.references?.evaluator_variant
                        ? {
                              id: step.references.evaluator_variant.id ?? undefined,
                              slug: step.references.evaluator_variant.slug ?? undefined,
                          }
                        : undefined,
                })
            }
        }

        // Build existing annotation map: evaluator slug → annotation
        const existingBySlug = new Map<string, Annotation>()
        for (const ann of existingAnnotations) {
            const ref = ann.references?.evaluator
            const key = ref?.slug ?? ref?.id
            if (key) {
                const evaluator = evaluatorMap.get(key)
                if (evaluator?.slug) {
                    existingBySlug.set(evaluator.slug, ann)
                }
            }
        }

        // Resolve the run ID and invocation step key BEFORE annotation creation
        // so we can use it in the links payload (matching EvalRunDetails flow).
        const runId = annotationSessionController.get.activeRunId()

        let invocationStepKey: string | null = null
        if (runId) {
            // Try cached scenario steps first
            const stepsQuery = getStore().get(
                evaluationRunMolecule.selectors.scenarioSteps({runId, scenarioId}),
            )
            let steps = stepsQuery.data ?? []

            // If cache is empty, fetch imperatively
            if (steps.length === 0) {
                try {
                    steps = await queryEvaluationResults({
                        projectId,
                        runId,
                        scenarioIds: [scenarioId],
                    })
                } catch {
                    // Ignore fetch errors
                }
            }

            for (const step of steps) {
                if (step.trace_id && step.step_key) {
                    invocationStepKey = step.step_key
                    break
                }
            }
        }

        // Derive span_id from trace_id if empty (EvalRunDetails does this too)
        const effectiveSpanId =
            spanId || (traceId.length === 36 ? traceId.replace(/-/g, "").slice(16) : "")

        // Submit annotations for each evaluator with non-empty metrics
        const promises: Promise<unknown>[] = []

        for (const [slug, fields] of Object.entries(metrics)) {
            if (isEmptyMetrics(fields)) continue

            const evaluator = evaluatorMap.get(slug)
            if (!evaluator) continue

            // Build outputs from metric fields (extract just values)
            const outputs: Record<string, unknown> = {}
            for (const [fieldKey, field] of Object.entries(fields)) {
                outputs[fieldKey] = field.value
            }

            const existingAnn = existingBySlug.get(slug)

            if (existingAnn) {
                // Use the annotation's own trace_id/span_id for the PATCH URL,
                // not the form controller's stored values (which may have empty spanId
                // for trace-based queues).
                promises.push(
                    updateAnnotation(projectId, existingAnn.trace_id, existingAnn.span_id, {
                        annotation: {
                            data: {outputs},
                            meta: existingAnn.meta
                                ? {
                                      name: existingAnn.meta.name,
                                      description: existingAnn.meta.description,
                                      tags: existingAnn.meta.tags,
                                  }
                                : undefined,
                        },
                    }),
                )
            } else {
                // Use the WORKFLOW ID (from evalIds / run step references),
                // NOT evaluator.id which is the revision ID.
                // The backend's annotation service uses this to look up
                // the evaluator via fetch_evaluator_revision(evaluator_ref).
                const evalWorkflowId =
                    workflowIdBySlug.get(slug) ?? evaluator.workflow_id ?? evaluator.id

                // Resolve step references for this evaluator (revision + variant)
                // so the backend can find the existing evaluator directly
                const stepRefs = stepRefsByEvalId.get(evalWorkflowId)

                // Build links using the invocation step key (matching EvalRunDetails)
                const linksKey = invocationStepKey || "invocation"
                const links: Record<string, {trace_id?: string; span_id?: string}> = {
                    [linksKey]: {
                        trace_id: traceId,
                        span_id: effectiveSpanId,
                    },
                }

                const createPayload: CreateAnnotationPayload = {
                    data: {outputs},
                    references: {
                        evaluator: {
                            id: evalWorkflowId,
                            slug: evaluator.slug ?? undefined,
                        },
                        ...(stepRefs?.evaluator_revision?.id
                            ? {evaluator_revision: stepRefs.evaluator_revision}
                            : {}),
                    },
                    links,
                    origin: "human",
                    kind: "adhoc",
                    channel: "web",
                    meta: {
                        name: evaluator.name ?? "",
                        description: evaluator.description ?? "",
                        tags: Object.keys(outputs),
                    },
                }
                promises.push(createAnnotation(projectId, createPayload))
            }
        }

        const responses = await Promise.all(promises)

        // Mark completed + advance IMMEDIATELY (don't block on post-submit ops)
        if (markComplete && scenarioId) {
            annotationSessionController.set.markCompleted(scenarioId)
            annotationSessionController.set.navigateNext()

            // Patch scenario status in background (non-blocking)
            patchScenarioStatus(projectId, scenarioId, "success").catch((err) =>
                console.warn("[annotationForm] Scenario status patch failed:", err),
            )

            // Check if all scenarios are done — update run status if so
            if (runId) {
                checkAndUpdateRunStatus(projectId, runId).catch((err) =>
                    console.warn("[annotationForm] Run status check failed:", err),
                )
            }
        }

        // Post-submission: upsert step results and save metrics (fire-and-forget)
        if (runId && invocationStepKey) {
            // Build a list of slug → {outputs, annotationTraceId, annotationSpanId}
            const submittedEntries: {
                slug: string
                outputs: Record<string, unknown>
                annotationTraceId: string
                annotationSpanId: string
            }[] = []

            let responseIdx = 0
            for (const [slug, fields] of Object.entries(metrics)) {
                if (isEmptyMetrics(fields)) continue

                const evaluator = evaluatorMap.get(slug)
                if (!evaluator) continue

                const outputs: Record<string, unknown> = {}
                for (const [fieldKey, field] of Object.entries(fields)) {
                    outputs[fieldKey] = field.value
                }

                const existingAnn = existingBySlug.get(slug)
                const response = responses[responseIdx] as Record<string, unknown> | undefined
                responseIdx++

                // For updates, use existing annotation's trace/span
                // For creates, the API response contains the new trace/span
                let annotationTraceId: string | undefined
                let annotationSpanId: string | undefined

                if (existingAnn) {
                    annotationTraceId = existingAnn.trace_id
                    annotationSpanId = existingAnn.span_id
                } else if (response) {
                    // createAnnotation returns unwrapped Annotation | null directly
                    annotationTraceId = (response as Record<string, unknown>)?.trace_id as
                        | string
                        | undefined
                    annotationSpanId = (response as Record<string, unknown>)?.span_id as
                        | string
                        | undefined
                }

                if (annotationTraceId && annotationSpanId) {
                    submittedEntries.push({
                        slug,
                        outputs,
                        annotationTraceId,
                        annotationSpanId,
                    })
                }
            }

            // Find existing annotation step keys to avoid duplicates
            const annotationSteps = getStore().get(
                evaluationRunMolecule.selectors.annotationSteps(runId),
            )
            const stepKeyBySlug = new Map<string, string>()
            for (const step of annotationSteps) {
                const evalSlug = step.references?.evaluator?.slug
                if (evalSlug && step.key) {
                    stepKeyBySlug.set(evalSlug, step.key)
                }
            }

            // Fire step result upserts and metric saves concurrently (fire-and-forget)
            const postSubmitPromises: Promise<void>[] = []

            for (const entry of submittedEntries) {
                // Use existing step key if available, otherwise construct one
                const annotationStepKey =
                    stepKeyBySlug.get(entry.slug) ?? `${invocationStepKey}.${entry.slug}`

                // Upsert step result
                postSubmitPromises.push(
                    upsertStepResultWithAnnotation({
                        projectId,
                        runId,
                        scenarioId,
                        stepKey: annotationStepKey,
                        annotationTraceId: entry.annotationTraceId,
                        annotationSpanId: entry.annotationSpanId,
                    }).catch((err) =>
                        console.warn("[annotationForm] Step result upsert failed:", err),
                    ),
                )

                // Save scenario metrics
                postSubmitPromises.push(
                    upsertAnnotationMetrics({
                        projectId,
                        runId,
                        scenarioId,
                        outputs: entry.outputs,
                        stepKey: annotationStepKey,
                    }).catch((err) => console.warn("[annotationForm] Metric save failed:", err)),
                )
            }

            // Fire and forget — don't block UI on post-submit operations.
            // These operations (step result upserts + metrics saves) are best-effort.
            // The link-based annotation fallback ensures data is found even if these fail.
            Promise.allSettled(postSubmitPromises).then(() => {
                // Invalidate caches AFTER post-submit ops complete so refetches get fresh data
                annotationSessionController.cache.invalidateScenarioAnnotations(scenarioId)
            })
        } else {
            // No post-submit ops — invalidate caches immediately
            annotationSessionController.cache.invalidateScenarioAnnotations(scenarioId)
        }

        // Invalidate annotation cache and progress
        invalidateAnnotationCacheByLink(traceId, spanId)
        if (queueId) {
            invalidateScenarioProgressCache(queueId)
        }
    } finally {
        set(isSubmittingAtomFamily(scenarioId), false)
    }
})

/** Clear all form state (call on session close) */
const clearFormStateAtom = atom(null, () => {
    // evaluatorIdsAtom is derived from session controller — clears automatically
    // when session is closed (activeQueueIdAtom → null → runId → null → empty [])
})

// ============================================================================
// IMPERATIVE API
// ============================================================================

function getStore() {
    return getDefaultStore()
}

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

/**
 * Annotation form controller — manages form state and submission.
 *
 * Follows the same controller pattern as `annotationSessionController`.
 */
export const annotationFormController = {
    // ========================================================================
    // SELECTORS (return atoms for reactive subscriptions)
    // ========================================================================
    selectors: {
        /** Effective metrics (baseline merged with edits) */
        effectiveMetrics: (scenarioId: string) => effectiveMetricsAtomFamily(scenarioId),
        /** Whether there are unsaved changes */
        hasPendingChanges: (scenarioId: string) => hasPendingChangesAtomFamily(scenarioId),
        /** Whether a submission is in progress */
        isSubmitting: (scenarioId: string) => isSubmittingAtomFamily(scenarioId),
        /** Evaluator IDs for the session */
        evaluatorIds: () => evaluatorIdsAtom,
        /** Resolved evaluators (derived from evaluatorIds + molecule) */
        evaluators: (scenarioId: string) => evaluatorsAtomFamily(scenarioId),
        /** Baseline metrics (from annotations + evaluator schemas) */
        baseline: (scenarioId: string) =>
            atom((get) => get(baselineAtomFamily(scenarioId)).baseline),
    },

    // ========================================================================
    // ACTIONS (write atoms for state mutations)
    // ========================================================================
    actions: {
        /** Set annotations + trace/span for a scenario */
        setScenarioContext: setScenarioContextAtom,
        /** Update a single metric field */
        updateMetric: updateMetricAtom,
        /** Reset edits for a scenario */
        resetEdits: resetEditsAtom,
        /** Submit annotations (and optionally mark complete) */
        submitAnnotations: submitAnnotationsAtom,
        /** Clear all form state */
        clearFormState: clearFormStateAtom,
    },

    // ========================================================================
    // GET (imperative read API)
    // ========================================================================
    get: {
        effectiveMetrics: (scenarioId: string) =>
            getStore().get(effectiveMetricsAtomFamily(scenarioId)),
        hasPendingChanges: (scenarioId: string) =>
            getStore().get(hasPendingChangesAtomFamily(scenarioId)),
        isSubmitting: (scenarioId: string) => getStore().get(isSubmittingAtomFamily(scenarioId)),
        evaluatorIds: () => getStore().get(evaluatorIdsAtom),
        evaluators: (scenarioId: string) => getStore().get(evaluatorsAtomFamily(scenarioId)),
    },

    // ========================================================================
    // SET (imperative write API)
    // ========================================================================
    set: {
        setScenarioContext: (ctx: ScenarioContext) => getStore().set(setScenarioContextAtom, ctx),
        updateMetric: (payload: UpdateMetricPayload) => getStore().set(updateMetricAtom, payload),
        resetEdits: (scenarioId: string) => getStore().set(resetEditsAtom, scenarioId),
        submitAnnotations: (payload: SubmitAnnotationsPayload) =>
            getStore().set(submitAnnotationsAtom, payload),
        clearFormState: () => getStore().set(clearFormStateAtom),
    },
}

export type AnnotationFormController = typeof annotationFormController
