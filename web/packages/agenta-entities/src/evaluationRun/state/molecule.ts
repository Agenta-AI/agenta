/**
 * EvaluationRun Molecule
 *
 * Unified API for evaluation run entity state management.
 * Uses batch fetching: individual run queries are automatically merged
 * into a single `POST /evaluations/runs/query` call.
 *
 * @example
 * ```typescript
 * import { evaluationRunMolecule } from '@agenta/entities/evaluationRun'
 *
 * // Selectors (reactive)
 * const data = useAtomValue(evaluationRunMolecule.selectors.data({projectId, runId}))
 * const annotationSteps = useAtomValue(
 *     evaluationRunMolecule.selectors.annotationSteps({projectId, runId}),
 * )
 *
 * // Imperative API (outside React)
 * const data = evaluationRunMolecule.get.data(projectId, runId)
 * ```
 *
 * @packageDocumentation
 */

import {createBatchFetcher} from "@agenta/shared/utils"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {StoreOptions} from "../../shared"
import {queryEvaluationRuns, queryEvaluationResults} from "../api"
import type {
    EvaluationRun,
    EvaluationRunDataMapping,
    EvaluationRunDataStep,
    EvaluationResult,
} from "../core"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// BATCH FETCHER
// ============================================================================

export interface RunKey {
    projectId: string
    runId: string
}

function runKeyEqual(a: RunKey, b: RunKey): boolean {
    return a.projectId === b.projectId && a.runId === b.runId
}

/**
 * Batch fetcher that collects individual run requests and merges them into
 * a single `POST /evaluations/runs/query` call.
 *
 * Components reading `evaluationRunMolecule.selectors.data({projectId, runId})` for
 * different run IDs within the same render cycle will trigger ONE API call.
 */
const runBatchFetcher = createBatchFetcher<RunKey, EvaluationRun | null>({
    serializeKey: ({projectId, runId}) => `${projectId}:${runId}`,
    batchFn: async (keys, serializedKeys) => {
        const results = new Map<string, EvaluationRun | null>()
        serializedKeys.forEach((key) => results.set(key, null))

        // Exactly one project is in scope at a time in the web app.
        const projectId = keys[0]?.projectId
        if (!projectId) return results
        if (keys.some((key) => key.projectId !== projectId)) {
            throw new Error("runBatchFetcher: requests span multiple projects")
        }

        const runIds = [...new Set(keys.map((key) => key.runId).filter(Boolean))]
        if (runIds.length === 0) return results

        const response = await queryEvaluationRuns({projectId, ids: runIds})

        // Index response by run ID
        const runsById = new Map<string, EvaluationRun>()
        for (const run of response.runs) {
            runsById.set(run.id, run)
        }

        keys.forEach((key, idx) => {
            results.set(serializedKeys[idx], runsById.get(key.runId) ?? null)
        })

        return results
    },
    maxBatchSize: 50,
})

// ============================================================================
// SINGLE ENTITY QUERY (with batch fetching)
// ============================================================================

/**
 * Query atom family for fetching a single evaluation run by ID.
 * Individual queries are automatically batched via `createBatchFetcher`.
 *
 * The projectId is supplied by the caller via the family key, so the molecule
 * no longer reads app-global state.
 */
export const evaluationRunQueryAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atomWithQuery(() => ({
            queryKey: ["evaluationRun", projectId, runId],
            queryFn: async (): Promise<EvaluationRun | null> => {
                if (!projectId || !runId) return null
                return runBatchFetcher({projectId, runId})
            },
            enabled: !!projectId && !!runId,
            retry: false,
            retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
            staleTime: 60_000,
        })),
    runKeyEqual,
)

// ============================================================================
// DERIVED SELECTORS
// ============================================================================

/**
 * Imperative, batched per-run fetch. Concurrent calls within a tick collapse into a
 * single `POST /evaluations/runs/query` via the shared batch fetcher. Use this from
 * non-jotai async contexts (e.g. another atomWithQuery's queryFn) that need the raw run
 * without subscribing to the molecule's reactive atom.
 */
export function fetchEvaluationRunBatched(key: RunKey): Promise<EvaluationRun | null> {
    return runBatchFetcher(key)
}

/**
 * Run data selector.
 */
const dataAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<EvaluationRun | null>((get) => {
            const query = get(evaluationRunQueryAtomFamily({projectId, runId}))
            return query.data ?? null
        }),
    runKeyEqual,
)

/**
 * Query state selector.
 */
const queryAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom((get) => {
            const query = get(evaluationRunQueryAtomFamily({projectId, runId}))
            return {
                data: query.data ?? null,
                isPending: query.isPending,
                isError: query.isError,
                error: query.error ?? null,
            }
        }),
    runKeyEqual,
)

/**
 * All steps from the run data.
 */
const stepsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<EvaluationRunDataStep[]>((get) => {
            const data = get(dataAtomFamily({projectId, runId}))
            return data?.data?.steps ?? []
        }),
    runKeyEqual,
)

/**
 * Annotation steps only (type === "annotation").
 * These represent the evaluators attached to the run.
 */
const annotationStepsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<EvaluationRunDataStep[]>((get) => {
            const steps = get(stepsAtomFamily({projectId, runId}))
            return steps.filter((step) => step.type === "annotation")
        }),
    runKeyEqual,
)

/**
 * Evaluator workflow IDs extracted from annotation steps' references.
 * Each annotation step references an evaluator via `references.evaluator.id`.
 */
const evaluatorIdsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<string[]>((get) => {
            const steps = get(annotationStepsAtomFamily({projectId, runId}))
            const ids: string[] = []
            for (const step of steps) {
                const evaluatorId = step.references?.evaluator?.id
                if (evaluatorId) {
                    ids.push(evaluatorId)
                }
            }
            return ids
        }),
    runKeyEqual,
)

/**
 * Evaluator revision IDs extracted from annotation steps' references.
 * Each annotation step references an evaluator revision via `references.evaluator_revision.id`.
 * These revision IDs are needed by the form controller to fetch evaluator schemas.
 */
const evaluatorRevisionIdsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<string[]>((get) => {
            const steps = get(annotationStepsAtomFamily({projectId, runId}))
            const ids: string[] = []
            for (const step of steps) {
                const revisionId = step.references?.evaluator_revision?.id
                if (revisionId) {
                    ids.push(revisionId)
                }
            }
            return ids
        }),
    runKeyEqual,
)

/**
 * All mappings from the run data.
 */
const mappingsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<EvaluationRunDataMapping[]>((get) => {
            const data = get(dataAtomFamily({projectId, runId}))
            return data?.data?.mappings ?? []
        }),
    runKeyEqual,
)

/**
 * Annotation mappings only — filtered to those whose step key matches an annotation step.
 */
const annotationMappingsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<EvaluationRunDataMapping[]>((get) => {
            const mappings = get(mappingsAtomFamily({projectId, runId}))
            const annotationSteps = get(annotationStepsAtomFamily({projectId, runId}))
            const annotationStepKeys = new Set(annotationSteps.map((s) => s.key))
            return mappings.filter((m) => m.step?.key && annotationStepKeys.has(m.step.key))
        }),
    runKeyEqual,
)

// ============================================================================
// SHARED KEY TYPES
// ============================================================================

interface ScenarioStepsKey {
    projectId: string
    runId: string
    scenarioId: string
}

function scenarioStepsKeyEqual(a: ScenarioStepsKey, b: ScenarioStepsKey): boolean {
    return a.projectId === b.projectId && a.runId === b.runId && a.scenarioId === b.scenarioId
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function getReferenceValue(
    step: EvaluationRunDataStep,
    refName: string,
    key: "id" | "slug",
): string | null {
    return normalizeString(step.references?.[refName]?.[key])
}

function stripOutputSuffix(value: string | null): string | null {
    if (!value) return null
    const parts = value.split(".").filter(Boolean)
    if (parts.length < 2) return value
    const last = parts.at(-1)?.toLowerCase()
    if (last !== "output" && last !== "outputs") return value
    return parts.slice(0, -1).join(".") || value
}

function lastSegment(value: string | null): string | null {
    if (!value) return null
    const parts = value.split(".").filter(Boolean)
    return parts.at(-1) ?? value
}

// ============================================================================
// CONVENIENCE SELECTORS (compound derived data)
// ============================================================================

/**
 * Annotation column definition — used by session controller and list view.
 * Combines annotation steps + annotation mappings, joined by step key,
 * with evaluator references extracted.
 */
export interface AnnotationColumnDef {
    stepKey: string
    columnName: string | null
    columnKind: string | null
    path: string | null
    evaluatorId: string | null
    evaluatorRevisionId: string | null
    evaluatorSlug: string | null
}

function getAnnotationEvaluatorSlug(
    step: EvaluationRunDataStep,
    mapping: EvaluationRunDataMapping,
): string | null {
    const candidates = [
        getReferenceValue(step, "evaluator", "slug"),
        getReferenceValue(step, "evaluator_variant", "slug"),
        lastSegment(normalizeString(step.key)),
        stripOutputSuffix(normalizeString(mapping.column?.name)),
        getReferenceValue(step, "evaluator_revision", "slug"),
    ]

    return candidates.find((candidate) => Boolean(candidate)) ?? null
}

/**
 * Annotation column definitions derived from run annotation steps + mappings.
 * Joins mappings to steps by key and extracts evaluator references.
 */
const annotationColumnDefsAtomFamily = atomFamily(
    ({projectId, runId}: RunKey) =>
        atom<AnnotationColumnDef[]>((get) => {
            const annotationSteps = get(annotationStepsAtomFamily({projectId, runId}))
            const mappings = get(annotationMappingsAtomFamily({projectId, runId}))

            const stepByKey = new Map(annotationSteps.map((s) => [s.key, s]))

            return mappings
                .filter((m) => m.step?.key && stepByKey.has(m.step.key))
                .map((m) => {
                    const step = stepByKey.get(m.step!.key)!
                    return {
                        stepKey: m.step!.key,
                        columnName: m.column?.name ?? null,
                        columnKind: m.column?.kind ?? null,
                        path: m.step!.path ?? null,
                        evaluatorId: getReferenceValue(step, "evaluator", "id"),
                        evaluatorRevisionId: getReferenceValue(step, "evaluator_revision", "id"),
                        evaluatorSlug: getAnnotationEvaluatorSlug(step, m),
                    }
                })
        }),
    runKeyEqual,
)

// ============================================================================
// SCENARIO STEPS (Evaluation Results)
// ============================================================================

/**
 * Fetch evaluation results (scenario steps) for a specific scenario.
 *
 * Returns all step results including trace_id and span_id references.
 * Uses `atomWithQuery` with imperative projectId read + retry.
 */
export const scenarioStepsQueryAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioStepsKey) =>
        atomWithQuery(() => ({
            queryKey: ["scenarioSteps", projectId, runId, scenarioId],
            queryFn: async (): Promise<EvaluationResult[]> => {
                if (!projectId || !runId || !scenarioId) return []
                return queryEvaluationResults({
                    projectId,
                    runId,
                    scenarioIds: [scenarioId],
                })
            },
            enabled: !!projectId && !!runId && !!scenarioId,
            retry: false,
            retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
            staleTime: 60_000,
        })),
    scenarioStepsKeyEqual,
)

/**
 * Derived atom: extract trace_id and span_id from the "input" step of a scenario.
 * The input step (or first step with a trace_id) provides the trace reference.
 */
const scenarioTraceRefAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioStepsKey) =>
        atom((get) => {
            const query = get(scenarioStepsQueryAtomFamily({projectId, runId, scenarioId}))
            const steps = query.data ?? []

            // Find the first step with a trace_id (typically the "input" step)
            for (const step of steps) {
                if (step.trace_id) {
                    return {
                        traceId: step.trace_id,
                        spanId: step.span_id ?? "",
                    }
                }
            }
            return {traceId: "", spanId: ""}
        }),
    scenarioStepsKeyEqual,
)

/**
 * Derived atom: extract testcase_id from the "input" step of a scenario.
 * The input step (or first step with a testcase_id) provides the testcase reference.
 */
const scenarioTestcaseRefAtomFamily = atomFamily(
    ({projectId, runId, scenarioId}: ScenarioStepsKey) =>
        atom((get) => {
            const query = get(scenarioStepsQueryAtomFamily({projectId, runId, scenarioId}))
            const steps = query.data ?? []

            // Find the first step with a testcase_id (typically the "input" step)
            for (const step of steps) {
                if (step.testcase_id) {
                    return {testcaseId: step.testcase_id}
                }
            }
            return {testcaseId: ""}
        }),
    scenarioStepsKeyEqual,
)

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate a single run's cache.
 */
function invalidateEvaluationRunCache({projectId, runId}: RunKey, options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(evaluationRunQueryAtomFamily({projectId, runId}))
    if (current?.refetch) {
        current.refetch()
    }
}

// ============================================================================
// MOLECULE DEFINITION
// ============================================================================

/**
 * EvaluationRun molecule — unified API for evaluation run entity state.
 *
 * Read-only entity (no draft/mutation support needed).
 * Individual run queries are batch-fetched automatically.
 */
export const evaluationRunMolecule = {
    // ========================================================================
    // SELECTORS (reactive atom families)
    // ========================================================================
    selectors: {
        /** Run data */
        data: dataAtomFamily,
        /** Query state (loading, error) */
        query: queryAtomFamily,
        /** All steps */
        steps: stepsAtomFamily,
        /** Annotation steps only (evaluators) */
        annotationSteps: annotationStepsAtomFamily,
        /** Evaluator workflow IDs from annotation step references */
        evaluatorIds: evaluatorIdsAtomFamily,
        /** Evaluator revision IDs from annotation step references */
        evaluatorRevisionIds: evaluatorRevisionIdsAtomFamily,
        /** All mappings from the run data */
        mappings: mappingsAtomFamily,
        /** Annotation mappings only (matched to annotation steps by step key) */
        annotationMappings: annotationMappingsAtomFamily,
        /** Annotation column definitions (steps + mappings joined with evaluator refs) */
        annotationColumnDefs: annotationColumnDefsAtomFamily,
        /** Scenario step results (evaluation results for a scenario) */
        scenarioSteps: scenarioStepsQueryAtomFamily,
        /** Trace/span reference for a scenario (derived from steps) */
        scenarioTraceRef: scenarioTraceRefAtomFamily,
        /** Testcase reference for a scenario (derived from steps) */
        scenarioTestcaseRef: scenarioTestcaseRefAtomFamily,
    },

    // ========================================================================
    // ATOMS (raw store atoms)
    // ========================================================================
    atoms: {
        /** Per-run query */
        query: evaluationRunQueryAtomFamily,
        /** Per-scenario step results query */
        scenarioSteps: scenarioStepsQueryAtomFamily,
    },

    // ========================================================================
    // GET (imperative read API)
    // ========================================================================
    get: {
        data: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(dataAtomFamily({projectId, runId})),
        steps: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(stepsAtomFamily({projectId, runId})),
        annotationSteps: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(annotationStepsAtomFamily({projectId, runId})),
        evaluatorIds: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(evaluatorIdsAtomFamily({projectId, runId})),
        evaluatorRevisionIds: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(evaluatorRevisionIdsAtomFamily({projectId, runId})),
        mappings: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(mappingsAtomFamily({projectId, runId})),
        annotationMappings: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(annotationMappingsAtomFamily({projectId, runId})),
        annotationColumnDefs: (projectId: string, runId: string, options?: StoreOptions) =>
            getStore(options).get(annotationColumnDefsAtomFamily({projectId, runId})),
        scenarioTraceRef: (
            projectId: string,
            runId: string,
            scenarioId: string,
            options?: StoreOptions,
        ) => getStore(options).get(scenarioTraceRefAtomFamily({projectId, runId, scenarioId})),
        scenarioTestcaseRef: (
            projectId: string,
            runId: string,
            scenarioId: string,
            options?: StoreOptions,
        ) => getStore(options).get(scenarioTestcaseRefAtomFamily({projectId, runId, scenarioId})),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateDetail: invalidateEvaluationRunCache,
    },
}
