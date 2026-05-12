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
 * const data = useAtomValue(evaluationRunMolecule.selectors.data(runId))
 * const annotationSteps = useAtomValue(evaluationRunMolecule.selectors.annotationSteps(runId))
 *
 * // Imperative API (outside React)
 * const data = evaluationRunMolecule.get.data(runId)
 * ```
 *
 * @packageDocumentation
 */

import {projectIdAtom} from "@agenta/shared/state"
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

interface RunBatchKey {
    projectId: string
    runId: string
}

/**
 * Batch fetcher that collects individual run requests and merges them into
 * a single `POST /evaluations/runs/query` call.
 *
 * Components reading `evaluationRunMolecule.selectors.data(runId)` for different
 * run IDs within the same render cycle will trigger ONE API call.
 */
const runBatchFetcher = createBatchFetcher<RunBatchKey, EvaluationRun | null>({
    serializeKey: ({projectId, runId}) => `${projectId}:${runId}`,
    batchFn: async (keys, serializedKeys) => {
        const results = new Map<string, EvaluationRun | null>()

        // Group by projectId
        const byProject = new Map<string, {runIds: string[]; keys: string[]}>()
        keys.forEach((key, idx) => {
            if (!key.projectId || !key.runId) {
                results.set(serializedKeys[idx], null)
                return
            }
            const existing = byProject.get(key.projectId)
            if (existing) {
                existing.runIds.push(key.runId)
                existing.keys.push(serializedKeys[idx])
            } else {
                byProject.set(key.projectId, {
                    runIds: [key.runId],
                    keys: [serializedKeys[idx]],
                })
            }
        })

        // Fetch all projects in parallel
        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, {runIds, keys: batchKeys}]) => {
                const response = await queryEvaluationRuns({projectId, ids: runIds})

                // Index response by run ID
                const runsById = new Map<string, EvaluationRun>()
                for (const run of response.runs) {
                    runsById.set(run.id, run)
                }

                // Map results back to serialized keys
                for (let i = 0; i < runIds.length; i++) {
                    results.set(batchKeys[i], runsById.get(runIds[i]) ?? null)
                }
            }),
        )

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
 * IMPORTANT: `atomWithQuery` in jotai-tanstack-query v0.11.0 does NOT
 * re-evaluate its getter when Jotai atom dependencies change after the
 * initial subscription. So we cannot rely on reactive `get(projectIdAtom)`.
 * Instead, `queryFn` reads `projectIdAtom` imperatively from the default
 * store at fetch time, and throws when it's not yet available so that
 * TanStack Query's `retry` mechanism re-attempts once projectId is set.
 */
export const evaluationRunQueryAtomFamily = atomFamily((runId: string) =>
    atomWithQuery(() => ({
        queryKey: ["evaluationRun", runId],
        queryFn: async (): Promise<EvaluationRun | null> => {
            const projectId = getStore().get(projectIdAtom)
            if (!runId) return null
            if (!projectId) {
                throw new Error("projectId not yet available")
            }
            return runBatchFetcher({projectId, runId})
        },
        enabled: !!runId,
        retry: (failureCount: number, error: Error) => {
            if (error?.message === "projectId not yet available" && failureCount < 5) {
                return true
            }
            return false
        },
        retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
        staleTime: 60_000,
    })),
)

// ============================================================================
// DERIVED SELECTORS
// ============================================================================

/**
 * Run data selector.
 */
const dataAtomFamily = atomFamily((runId: string) =>
    atom<EvaluationRun | null>((get) => {
        const query = get(evaluationRunQueryAtomFamily(runId))
        return query.data ?? null
    }),
)

/**
 * Query state selector.
 */
const queryAtomFamily = atomFamily((runId: string) =>
    atom((get) => {
        const query = get(evaluationRunQueryAtomFamily(runId))
        return {
            data: query.data ?? null,
            isPending: query.isPending,
            isError: query.isError,
            error: query.error ?? null,
        }
    }),
)

/**
 * All steps from the run data.
 */
const stepsAtomFamily = atomFamily((runId: string) =>
    atom<EvaluationRunDataStep[]>((get) => {
        const data = get(dataAtomFamily(runId))
        return data?.data?.steps ?? []
    }),
)

/**
 * Annotation steps only (type === "annotation").
 * These represent the evaluators attached to the run.
 */
const annotationStepsAtomFamily = atomFamily((runId: string) =>
    atom<EvaluationRunDataStep[]>((get) => {
        const steps = get(stepsAtomFamily(runId))
        return steps.filter((step) => step.type === "annotation")
    }),
)

/**
 * Evaluator workflow IDs extracted from annotation steps' references.
 * Each annotation step references an evaluator via `references.evaluator.id`.
 */
const evaluatorIdsAtomFamily = atomFamily((runId: string) =>
    atom<string[]>((get) => {
        const steps = get(annotationStepsAtomFamily(runId))
        const ids: string[] = []
        for (const step of steps) {
            const evaluatorId = step.references?.evaluator?.id
            if (evaluatorId) {
                ids.push(evaluatorId)
            }
        }
        return ids
    }),
)

/**
 * Evaluator revision IDs extracted from annotation steps' references.
 * Each annotation step references an evaluator revision via `references.evaluator_revision.id`.
 * These revision IDs are needed by the form controller to fetch evaluator schemas.
 */
const evaluatorRevisionIdsAtomFamily = atomFamily((runId: string) =>
    atom<string[]>((get) => {
        const steps = get(annotationStepsAtomFamily(runId))
        const ids: string[] = []
        for (const step of steps) {
            const revisionId = step.references?.evaluator_revision?.id
            if (revisionId) {
                ids.push(revisionId)
            }
        }
        return ids
    }),
)

/**
 * All mappings from the run data.
 */
const mappingsAtomFamily = atomFamily((runId: string) =>
    atom<EvaluationRunDataMapping[]>((get) => {
        const data = get(dataAtomFamily(runId))
        return data?.data?.mappings ?? []
    }),
)

/**
 * Annotation mappings only — filtered to those whose step key matches an annotation step.
 */
const annotationMappingsAtomFamily = atomFamily((runId: string) =>
    atom<EvaluationRunDataMapping[]>((get) => {
        const mappings = get(mappingsAtomFamily(runId))
        const annotationSteps = get(annotationStepsAtomFamily(runId))
        const annotationStepKeys = new Set(annotationSteps.map((s) => s.key))
        return mappings.filter((m) => m.step?.key && annotationStepKeys.has(m.step.key))
    }),
)

// ============================================================================
// SHARED KEY TYPES
// ============================================================================

interface ScenarioStepsKey {
    runId: string
    scenarioId: string
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
    evaluatorSlug: string | null
}

/**
 * Annotation column definitions derived from run annotation steps + mappings.
 * Joins mappings to steps by key and extracts evaluator references.
 */
const annotationColumnDefsAtomFamily = atomFamily((runId: string) =>
    atom<AnnotationColumnDef[]>((get) => {
        const annotationSteps = get(annotationStepsAtomFamily(runId))
        const mappings = get(annotationMappingsAtomFamily(runId))

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
                    evaluatorId: step.references?.evaluator?.id ?? null,
                    evaluatorSlug: step.references?.evaluator?.slug ?? null,
                }
            })
    }),
)

/**
 * Step references indexed by evaluator ID.
 * Maps evaluator workflow ID → {evaluator_revision, evaluator_variant} refs.
 * Used during annotation creation to build the correct references payload.
 */
interface StepEvaluatorRefs {
    evaluator_revision?: {id?: string; slug?: string}
    evaluator_variant?: {id?: string; slug?: string}
}

const stepReferencesByEvaluatorIdAtomFamily = atomFamily((runId: string) =>
    atom<Map<string, StepEvaluatorRefs>>((get) => {
        const steps = get(annotationStepsAtomFamily(runId))
        const refMap = new Map<string, StepEvaluatorRefs>()
        for (const step of steps) {
            const evalId = step.references?.evaluator?.id
            if (evalId) {
                refMap.set(evalId, {
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
        return refMap
    }),
)

/**
 * Step keys indexed by evaluator slug.
 * Maps evaluator slug → annotation step key.
 * Used for duplicate detection and step key resolution during submission.
 */
const stepKeysByEvaluatorSlugAtomFamily = atomFamily((runId: string) =>
    atom<Map<string, string>>((get) => {
        const steps = get(annotationStepsAtomFamily(runId))
        const keyMap = new Map<string, string>()
        for (const step of steps) {
            const evalSlug = step.references?.evaluator?.slug
            if (evalSlug && step.key) {
                keyMap.set(evalSlug, step.key)
            }
        }
        return keyMap
    }),
)

/**
 * Invocation step key for a scenario.
 * Finds the first step result with a trace_id and step_key (the invocation step).
 * Used for building annotation links during submission.
 */
const scenarioInvocationStepKeyAtomFamily = atomFamily(
    ({runId, scenarioId}: ScenarioStepsKey) =>
        atom<string | null>((get) => {
            const query = get(scenarioStepsQueryAtomFamily({runId, scenarioId}))
            const steps = query.data ?? []
            for (const step of steps) {
                if (step.trace_id && step.step_key) {
                    return step.step_key
                }
            }
            return null
        }),
    (a: ScenarioStepsKey, b: ScenarioStepsKey) =>
        a.runId === b.runId && a.scenarioId === b.scenarioId,
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
    ({runId, scenarioId}: ScenarioStepsKey) =>
        atomWithQuery(() => ({
            queryKey: ["scenarioSteps", runId, scenarioId],
            queryFn: async (): Promise<EvaluationResult[]> => {
                const projectId = getStore().get(projectIdAtom)
                if (!runId || !scenarioId) return []
                if (!projectId) {
                    throw new Error("projectId not yet available")
                }
                return queryEvaluationResults({
                    projectId,
                    runId,
                    scenarioIds: [scenarioId],
                })
            },
            enabled: !!runId && !!scenarioId,
            retry: (failureCount: number, error: Error) => {
                if (error?.message === "projectId not yet available" && failureCount < 5) {
                    return true
                }
                return false
            },
            retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
            staleTime: 60_000,
        })),
    (a: ScenarioStepsKey, b: ScenarioStepsKey) =>
        a.runId === b.runId && a.scenarioId === b.scenarioId,
)

/**
 * Derived atom: extract trace_id and span_id from the "input" step of a scenario.
 * The input step (or first step with a trace_id) provides the trace reference.
 */
const scenarioTraceRefAtomFamily = atomFamily(
    ({runId, scenarioId}: ScenarioStepsKey) =>
        atom((get) => {
            const query = get(scenarioStepsQueryAtomFamily({runId, scenarioId}))
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
    (a: ScenarioStepsKey, b: ScenarioStepsKey) =>
        a.runId === b.runId && a.scenarioId === b.scenarioId,
)

/**
 * Derived atom: extract testcase_id from the "input" step of a scenario.
 * The input step (or first step with a testcase_id) provides the testcase reference.
 */
const scenarioTestcaseRefAtomFamily = atomFamily(
    ({runId, scenarioId}: ScenarioStepsKey) =>
        atom((get) => {
            const query = get(scenarioStepsQueryAtomFamily({runId, scenarioId}))
            const steps = query.data ?? []

            // Find the first step with a testcase_id (typically the "input" step)
            for (const step of steps) {
                if (step.testcase_id) {
                    return {testcaseId: step.testcase_id}
                }
            }
            return {testcaseId: ""}
        }),
    (a: ScenarioStepsKey, b: ScenarioStepsKey) =>
        a.runId === b.runId && a.scenarioId === b.scenarioId,
)

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate a single run's cache.
 */
export function invalidateEvaluationRunCache(runId: string, options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(evaluationRunQueryAtomFamily(runId))
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
        /** Step references indexed by evaluator ID (for annotation creation) */
        stepReferencesByEvaluatorId: stepReferencesByEvaluatorIdAtomFamily,
        /** Step keys indexed by evaluator slug (for duplicate detection) */
        stepKeysByEvaluatorSlug: stepKeysByEvaluatorSlugAtomFamily,
        /** Invocation step key for a scenario (first step with trace_id) */
        scenarioInvocationStepKey: scenarioInvocationStepKeyAtomFamily,
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
        data: (runId: string, options?: StoreOptions) =>
            getStore(options).get(dataAtomFamily(runId)),
        steps: (runId: string, options?: StoreOptions) =>
            getStore(options).get(stepsAtomFamily(runId)),
        annotationSteps: (runId: string, options?: StoreOptions) =>
            getStore(options).get(annotationStepsAtomFamily(runId)),
        evaluatorIds: (runId: string, options?: StoreOptions) =>
            getStore(options).get(evaluatorIdsAtomFamily(runId)),
        evaluatorRevisionIds: (runId: string, options?: StoreOptions) =>
            getStore(options).get(evaluatorRevisionIdsAtomFamily(runId)),
        mappings: (runId: string, options?: StoreOptions) =>
            getStore(options).get(mappingsAtomFamily(runId)),
        annotationMappings: (runId: string, options?: StoreOptions) =>
            getStore(options).get(annotationMappingsAtomFamily(runId)),
        annotationColumnDefs: (runId: string, options?: StoreOptions) =>
            getStore(options).get(annotationColumnDefsAtomFamily(runId)),
        stepReferencesByEvaluatorId: (runId: string, options?: StoreOptions) =>
            getStore(options).get(stepReferencesByEvaluatorIdAtomFamily(runId)),
        stepKeysByEvaluatorSlug: (runId: string, options?: StoreOptions) =>
            getStore(options).get(stepKeysByEvaluatorSlugAtomFamily(runId)),
        scenarioInvocationStepKey: (runId: string, scenarioId: string, options?: StoreOptions) =>
            getStore(options).get(scenarioInvocationStepKeyAtomFamily({runId, scenarioId})),
        scenarioTraceRef: (runId: string, scenarioId: string, options?: StoreOptions) =>
            getStore(options).get(scenarioTraceRefAtomFamily({runId, scenarioId})),
        scenarioTestcaseRef: (runId: string, scenarioId: string, options?: StoreOptions) =>
            getStore(options).get(scenarioTestcaseRefAtomFamily({runId, scenarioId})),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        invalidateDetail: invalidateEvaluationRunCache,
    },
}

export type EvaluationRunMolecule = typeof evaluationRunMolecule
