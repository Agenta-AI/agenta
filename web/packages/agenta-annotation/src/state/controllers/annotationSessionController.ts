/**
 * Annotation Session Controller
 *
 * Feature-level controller for orchestrating annotation workflows.
 * Manages the session lifecycle: open queue → navigate items → submit annotations → close.
 *
 * The controller is the **single access point** for all queue + per-task data.
 * Queue-level selectors derive from molecules (simpleQueueMolecule, evaluationRunMolecule).
 * Per-task selectors resolve trace refs, trace data, root spans, and annotations
 * keyed by scenarioId — components just read from controller selectors.
 *
 * This follows the same controller pattern as `playgroundController`:
 * - **selectors**: Return atoms for reactive subscriptions
 * - **actions**: Write atoms for state mutations
 * - **get/set**: Imperative API for callbacks outside React
 *
 * @example
 * ```typescript
 * import { annotationSessionController } from '@agenta/annotation'
 *
 * // Queue-level selectors
 * const isActive = useAtomValue(annotationSessionController.selectors.isActive())
 * const progress = useAtomValue(annotationSessionController.selectors.progress())
 * const evaluatorIds = useAtomValue(annotationSessionController.selectors.evaluatorIds())
 *
 * // Per-task selectors (keyed by scenarioId)
 * const traceRef = useAtomValue(annotationSessionController.selectors.scenarioTraceRef(scenarioId))
 * const annotations = useAtomValue(annotationSessionController.selectors.scenarioAnnotations(scenarioId))
 *
 * // Actions
 * const openQueue = useSetAtom(annotationSessionController.actions.openQueue)
 * openQueue({ queueId: 'abc-123', queueType: 'simple' })
 * ```
 *
 * @packageDocumentation
 */

import type {Annotation} from "@agenta/entities/annotation"
import {queryAnnotations} from "@agenta/entities/annotation"
import {
    evaluationRunMolecule,
    queryEvaluationResults,
    type EvaluationResult,
    type EvaluationRunDataStep,
} from "@agenta/entities/evaluationRun"
import type {QueueType} from "@agenta/entities/queue"
import {registerQueueTypeHint, clearQueueTypeHint} from "@agenta/entities/queue"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {
    traceEntityAtomFamily,
    traceRootSpanAtomFamily,
    type TraceSpan,
} from "@agenta/entities/trace"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    evaluationSessionController as sessionEngine,
    listColumnSelectors as evaluationsListColumns,
    OUTPUT_KEYS,
    registerSessionCallbacks as registerEngineCallbacks,
    scenarioDataSelectors,
    resolveMetricValue,
    resolveMetricStats,
    type ScenarioMetricData,
} from "@agenta/evaluations/state"
import {axios, queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    filterQueueScopedAnnotations,
    selectQueueScopedAnnotation,
    type TestsetSyncEvaluator,
} from "../testsetSync"
import type {
    AnnotationColumnDef,
    OpenQueuePayload,
    ApplyRouteStatePayload,
    AnnotationSessionCallbacks,
    SessionView,
    ScenarioEvaluatorKey,
    ScenarioMetricForEvaluator,
    EvaluatorStepRef,
} from "../types"

import {
    addScenariosToTestsetAtom,
    addToTestsetExportJobAtom,
    addToTestsetModalOpenAtom,
    addToTestsetScenarioIdsAtom,
    addToTestsetScopeAtom,
    canAddToTestsetAtom,
    canSyncToTestsetAtom,
    closeAddToTestsetModalAtom,
    defaultTargetTestsetNameAtom,
    isAddToTestsetExportingAtom,
    openAddToTestsetModalAtom,
    pendingTestsetSelectionAtom,
    pendingTestsetSelectionNameAtom,
    selectedScenarioIdsAtom,
    setPendingTestsetSelectionAtom,
    setSelectedScenarioIdsAtom,
    syncToTestsetsAtom,
    type AddScenariosToTestsetPayload,
    type AddToTestsetScope,
} from "./addToTestset"

export type {AddToTestsetExportJob, AddToTestsetScope} from "./addToTestset"

// ============================================================================
// CORE ATOMS
// ============================================================================

/** The active queue ID being annotated */
export const activeQueueIdAtom = atom<string | null>(null)

/** The active queue's type (simple or evaluation) */
const activeQueueTypeAtom = atom<QueueType | null>(null)

/** The evaluation run ID — derived from queue data via simpleQueueMolecule */
export const activeRunIdAtom = atom<string | null>((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return null
    return get(simpleQueueMolecule.selectors.runId(queueId))
})

type ScenarioRecord = Record<string, unknown>

// --- Session navigation/focus/view re-bound to the generic engine ------------
// (@agenta/evaluations session engine). Annotation feeds it the QUEUE scenario source
// in openQueue; these locals now point at the engine's atoms so every internal reader and
// the public facade stay unchanged. The engine owns navigation/progress/focus/view; the
// scenario source stays queue-scoped (user-filtered) — see openQueueAtom.
const focusedScenarioIdAtom = sessionEngine.selectors.focusedScenarioId()

/** Full scenario records (queue scenarios, engine-ordered) — cast for the local helpers. */
export const scenarioRecordsAtom = atom<ScenarioRecord[]>(
    (get) => get(sessionEngine.selectors.scenarioRecords()) as ScenarioRecord[],
)

function findScenarioRecordById(
    records: ScenarioRecord[],
    scenarioId: string,
): ScenarioRecord | null {
    return records.find((scenario) => scenario.id === scenarioId) ?? null
}

function readScenarioRefString(
    scenario: ScenarioRecord | null,
    key: "trace_id" | "span_id" | "testcase_id",
): string {
    if (!scenario) return ""

    const direct = scenario[key]
    if (typeof direct === "string" && direct) return direct

    const tags = scenario.tags as Record<string, unknown> | null | undefined
    const tagValue = tags?.[key]
    if (typeof tagValue === "string" && tagValue) return tagValue

    const meta = scenario.meta as Record<string, unknown> | null | undefined
    const metaValue = meta?.[key]
    if (typeof metaValue === "string" && metaValue) return metaValue

    return ""
}

function extractScenarioTraceRef(scenario: ScenarioRecord | null): {
    traceId: string
    spanId: string
} {
    return {
        traceId: readScenarioRefString(scenario, "trace_id"),
        spanId: readScenarioRefString(scenario, "span_id"),
    }
}

function extractScenarioTestcaseRef(scenario: ScenarioRecord | null): {testcaseId: string} {
    return {
        testcaseId: readScenarioRefString(scenario, "testcase_id"),
    }
}

/** All scenario IDs / query state / view / completion — re-bound to the engine. */
export const scenarioIdsAtom = sessionEngine.selectors.scenarioIds()
const scenariosQueryAtom = sessionEngine.selectors.scenariosQuery()
const activeSessionViewAtom = sessionEngine.selectors.activeView()
const hideCompletedInFocusAtom = sessionEngine.selectors.hideCompletedInFocus()
const focusAutoNextAtom = sessionEngine.selectors.focusAutoNext()
export const completedScenarioIdsAtom = sessionEngine.selectors.completedScenarioIds()

// Scenario ordering + navigable filtering are owned by the engine now.
const syncScenarioOrderAtom = sessionEngine.actions.syncScenarioOrder
const navigableScenarioIdsAtom = sessionEngine.selectors.navigableScenarioIds()

// ============================================================================
// DERIVED ATOMS — Queue-level
// ============================================================================

/** Is a session currently active? */
const isActiveAtom = atom<boolean>((get) => get(activeQueueIdAtom) !== null)

// Navigation / progress / status are owned by the engine (re-bound).
const currentScenarioIdAtom = sessionEngine.selectors.currentScenarioId()
const currentScenarioIndexAtom = sessionEngine.selectors.currentScenarioIndex()
const hasNextAtom = sessionEngine.selectors.hasNext()
const hasPrevAtom = sessionEngine.selectors.hasPrev()
const progressAtom = sessionEngine.selectors.progress()
const isCurrentCompletedAtom = sessionEngine.selectors.isCurrentCompleted()
const scenarioStatusesAtom = sessionEngine.selectors.scenarioStatuses()

/** Queue name — derived from simpleQueueMolecule */
export const queueNameAtom = atom<string | null>((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return null
    return get(simpleQueueMolecule.selectors.name(queueId))
})

/** Queue kind (traces / testcases) — derived from simpleQueueMolecule */
export const queueKindAtom = atom<string | null>((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return null
    return get(simpleQueueMolecule.selectors.kind(queueId))
})

/** Queue description — derived from simpleQueueMolecule */
const queueDescriptionAtom = atom<string | null>((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return null
    const data = get(simpleQueueMolecule.selectors.data(queueId))
    return data?.description ?? null
})

/**
 * Evaluator workflow IDs — derived from evaluation run annotation steps.
 * Uses `step.references.evaluator.id` (workflow/artifact ID).
 * Same resolution path as the working queues table (EvaluatorNamesCell).
 */
const evaluatorIdsAtom = atom<string[]>((get) => {
    const runId = get(activeRunIdAtom)
    const projectId = get(projectIdAtom)
    if (!runId || !projectId) return []
    return get(scenarioDataSelectors.evaluatorIds({projectId, runId}))
})

/**
 * Evaluator revision IDs — derived from evaluation run annotation steps.
 * Uses `step.references.evaluator_revision.id` (specific revision ID).
 * Kept for revision-level resolution when needed.
 */
const evaluatorRevisionIdsAtom = atom<string[]>((get) => {
    const runId = get(activeRunIdAtom)
    const projectId = get(projectIdAtom)
    if (!runId || !projectId) return []
    return get(scenarioDataSelectors.evaluatorRevisionIds({projectId, runId}))
})

function deriveEvaluatorSlugFromStepKey(stepKey: string | null | undefined): string | null {
    if (!stepKey) return null
    const parts = stepKey.split(".").filter(Boolean)
    return parts.at(-1) ?? null
}

/**
 * Ordered evaluator references from annotation steps.
 * Each entry preserves the queue's pinned evaluator revision while keeping the
 * artifact/variant IDs needed for later annotation submits.
 */
const evaluatorStepRefsAtom = atom<EvaluatorStepRef[]>((get) => {
    const runId = get(activeRunIdAtom)
    const projectId = get(projectIdAtom)
    if (!runId || !projectId) return []
    return get(scenarioDataSelectors.evaluatorStepRefs({projectId, runId}))
})

/** Evaluator metadata for queue-scoped testcase sync. */
export const testsetSyncEvaluatorsAtom = atom<TestsetSyncEvaluator[]>((get) => {
    const runId = get(activeRunIdAtom)
    const projectId = get(projectIdAtom)
    if (!runId || !projectId) return []

    const byKey = new Map<string, TestsetSyncEvaluator>()
    const annotationSteps = get(evaluationRunMolecule.selectors.annotationSteps({projectId, runId}))

    for (const step of annotationSteps) {
        const workflowId = step.references?.evaluator?.id ?? null
        const evaluatorEntity = workflowId ? get(workflowMolecule.selectors.data(workflowId)) : null
        const name = evaluatorEntity?.name?.trim() || null
        const slug =
            step.references?.evaluator?.slug ??
            step.references?.evaluator_variant?.slug ??
            deriveEvaluatorSlugFromStepKey(step.key) ??
            evaluatorEntity?.slug ??
            step.references?.evaluator_revision?.slug

        if (!slug && !workflowId) continue
        const key = workflowId ?? slug
        if (!key) continue

        byKey.set(key, {
            slug: slug ?? "",
            name,
            workflowId,
        })
    }

    return Array.from(byKey.values()).filter((evaluator) => Boolean(evaluator.slug))
})

/**
 * Annotation column definitions — delegates to the molecule's convenience selector.
 * Each entry represents a table column driven by an evaluation run mapping.
 */
const annotationColumnDefsAtom = atom<AnnotationColumnDef[]>((get) => {
    const runId = get(activeRunIdAtom)
    const projectId = get(projectIdAtom)
    if (!runId || !projectId) return []
    return get(
        scenarioDataSelectors.evaluatorColumnDefs({projectId, runId}),
    ) as AnnotationColumnDef[]
})

/**
 * Trace input keys — discovered from the first scenario's trace inputs.
 *
 * Delegates to the generic evaluations list-column tier
 * (`evaluationsListColumns.traceInputKeys`), which reads the session engine's
 * injected `kind` + `{projectId, runId}` context. Annotation injects its queue
 * `kind` via `setScenarioSource` in `openQueue`.
 */
const traceInputKeysAtom = evaluationsListColumns.traceInputKeys()

/**
 * Testcase data — fetched by testcaseId via atomWithQuery.
 * Used by list view cell renderers and testcase key discovery.
 */
const testcaseDataAtomFamily = atomFamily((testcaseId: string) =>
    atom((get) => {
        const projectId = get(projectIdAtom)
        return get(scenarioDataSelectors.testcaseData({projectId: projectId ?? "", testcaseId}))
    }),
)

/**
 * Testcase input keys — discovered from all testcase data in the queue.
 * Delegates to the generic evaluations list-column tier (which internally
 * resolves the queue's testcase IDs + batch testcase data).
 */
const testcaseInputKeysAtom = evaluationsListColumns.testcaseInputKeys()

/**
 * Output-key category set — re-exported from the generic evaluations list-column
 * tier (canonical copy now lives there). Kept exported here so existing
 * consumers (`@agenta/annotation`'s `OUTPUT_KEYS`) keep resolving.
 */
export {OUTPUT_KEYS}

// ============================================================================
// DERIVED ATOM — Full list column definitions
// ============================================================================

/**
 * Complete ordered list of column definitions for the scenario list table.
 * Delegates to the generic evaluations list-column tier, which reads the
 * session engine's injected `kind` + context and the generic scenario-data
 * selectors.
 */
const listColumnDefsAtom = evaluationsListColumns.listColumnDefs()

// ============================================================================
// DERIVED ATOMS — Per-task (keyed by scenarioId)
// ============================================================================

/**
 * Trace ref for a scenario — derived from evaluation run steps.
 * Resolves trace_id and span_id from the scenario's step results.
 */
export const scenarioStepsQueryStateAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const runId = get(activeRunIdAtom)
        const projectId = get(projectIdAtom)
        if (!runId || !scenarioId || !projectId) return null
        return get(scenarioDataSelectors.scenarioSteps({projectId, runId, scenarioId}))
    }),
)

/**
 * Trace ref for a scenario — derived from evaluation run steps.
 * Resolves trace_id and span_id from the scenario's step results.
 */
export const scenarioTraceRefAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const records = get(scenarioRecordsAtom)
        const directRef = extractScenarioTraceRef(findScenarioRecordById(records, scenarioId))

        const runId = get(activeRunIdAtom)
        const projectId = get(projectIdAtom)
        if (!runId || !scenarioId || !projectId) return directRef

        const stepRef = get(scenarioDataSelectors.scenarioTraceRef({projectId, runId, scenarioId}))
        if (stepRef.traceId) return stepRef

        return directRef
    }),
)

/**
 * Testcase ref for a scenario — derived from evaluation run steps.
 * Resolves testcase_id from the scenario's step results.
 */
export const scenarioTestcaseRefAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const records = get(scenarioRecordsAtom)
        const directRef = extractScenarioTestcaseRef(findScenarioRecordById(records, scenarioId))

        const runId = get(activeRunIdAtom)
        const projectId = get(projectIdAtom)
        if (!runId || !scenarioId || !projectId) return directRef

        const stepRef = get(
            scenarioDataSelectors.scenarioTestcaseRef({projectId, runId, scenarioId}),
        )
        if (stepRef.testcaseId) return stepRef

        return directRef
    }),
)

/**
 * Full trace query — fetched lazily via traceEntityAtomFamily.
 * Returns the TanStack query state (isPending, isError, data).
 */
const scenarioTraceQueryAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const {traceId} = get(scenarioTraceRefAtomFamily(scenarioId))
        if (!traceId) return null
        return get(traceEntityAtomFamily(traceId))
    }),
)

/**
 * Root span for a scenario — derived from traceRootSpanAtomFamily.
 * Resolves scenarioId → traceId → root span.
 */
const scenarioRootSpanAtomFamily = atomFamily((scenarioId: string) =>
    atom<TraceSpan | null>((get) => {
        const {traceId} = get(scenarioTraceRefAtomFamily(scenarioId))
        if (!traceId) return null
        return get(traceRootSpanAtomFamily(traceId))
    }),
)

/**
 * Annotation step trace IDs for a scenario.
 *
 * Annotations are stored as separate traces with their own trace_ids.
 * To fetch them, we need the trace_ids from the **annotation step results**
 * (not the input/invocation step's trace_id).
 *
 * Flow: scenarioId → evaluation result steps → filter annotation steps → extract trace_ids
 */
const scenarioAnnotationTraceIdsAtomFamily = atomFamily((scenarioId: string) =>
    atom<string[]>((get) => {
        const runId = get(activeRunIdAtom)
        const projectId = get(projectIdAtom)
        if (!runId || !scenarioId || !projectId) return []

        // Get annotation step info from the run definition
        const annotationSteps = get(
            evaluationRunMolecule.selectors.annotationSteps({projectId, runId}),
        )
        if (annotationSteps.length === 0) return []

        // Get scenario step results (evaluation results)
        const stepsQuery = get(
            evaluationRunMolecule.selectors.scenarioSteps({projectId, runId, scenarioId}),
        )
        const steps = stepsQuery.data ?? []

        return extractAnnotationTraceIdsFromSteps({annotationSteps, steps})
    }),
)

function buildAnnotationStepMatchers(annotationSteps: EvaluationRunDataStep[]) {
    const stepKeys = new Set<string>()
    const suffixes = new Set<string>()

    for (const step of annotationSteps) {
        if (step.key) {
            stepKeys.add(step.key)

            const dashIdx = step.key.indexOf("-")
            if (dashIdx >= 0) suffixes.add(step.key.slice(dashIdx + 1))
        }

        const evaluatorSlug = step.references?.evaluator?.slug
        if (evaluatorSlug) suffixes.add(evaluatorSlug)
    }

    return {stepKeys, suffixes}
}

export function extractAnnotationTraceIdsFromSteps({
    annotationSteps,
    steps,
}: {
    annotationSteps: EvaluationRunDataStep[]
    steps: EvaluationResult[]
}): string[] {
    const {stepKeys, suffixes} = buildAnnotationStepMatchers(annotationSteps)
    const traceIds = new Set<string>()

    for (const step of steps) {
        if (!step.step_key || !step.trace_id) continue

        if (stepKeys.has(step.step_key)) {
            traceIds.add(step.trace_id)
            continue
        }

        const dotIdx = step.step_key.lastIndexOf(".")
        if (dotIdx < 0) continue

        const suffix = step.step_key.slice(dotIdx + 1)
        if (suffixes.has(suffix)) {
            traceIds.add(step.trace_id)
        }
    }

    return Array.from(traceIds)
}

function mergeAnnotationsByTraceSpan(
    primary: Annotation[],
    fallback: Annotation[] = [],
): Annotation[] {
    const byKey = new Map<string, Annotation>()

    for (const annotation of [...primary, ...fallback]) {
        if (!annotation?.trace_id || !annotation?.span_id) continue
        byKey.set(`${annotation.trace_id}:${annotation.span_id}`, annotation)
    }

    return Array.from(byKey.values())
}

interface ScenarioAnnotationsKey {
    scenarioId: string
    annotationTraceIds: string
}

/**
 * Annotations for a scenario — fetched via atomWithQuery.
 *
 * Uses trace_ids from the annotation step results (not the input step).
 * The backend `annotation_links` filter matches annotations by their own trace_id,
 * and annotation steps store the annotation's own trace_id in their result.
 */
const scenarioAnnotationsQueryAtomFamily = atomFamily(
    ({scenarioId, annotationTraceIds}: ScenarioAnnotationsKey) =>
        atomWithQuery(() => {
            const traceIdList = annotationTraceIds ? annotationTraceIds.split("|") : []

            return {
                queryKey: ["scenarioAnnotations", scenarioId, annotationTraceIds],
                queryFn: async (): Promise<Annotation[]> => {
                    const projectId = getStore().get(projectIdAtom)
                    if (!projectId || traceIdList.length === 0) return []

                    const response = await queryAnnotations({
                        projectId,
                        annotationLinks: traceIdList.map((tid) => ({trace_id: tid})),
                    })
                    return response.annotations ?? []
                },
                enabled: traceIdList.length > 0,
                retry: (failureCount: number, error: Error) => {
                    if (error?.message === "projectId not yet available" && failureCount < 5) {
                        return true
                    }
                    return false
                },
                retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
                staleTime: 30_000,
            }
        }),
    (a: ScenarioAnnotationsKey, b: ScenarioAnnotationsKey) =>
        a.scenarioId === b.scenarioId && a.annotationTraceIds === b.annotationTraceIds,
)

/**
 * Testcase-based annotation query — finds annotations by testcase reference.
 * This is the fallback for testcase-based queues where no trace_id exists.
 */
const scenarioAnnotationsByTestcaseQueryAtomFamily = atomFamily(
    ({scenarioId, testcaseId}: {scenarioId: string; testcaseId: string}) =>
        atomWithQuery((get) => {
            // Read queue + project reactively so the cache key includes them.
            // The queryFn filters by the active queue, so without these in the
            // key a cached result could be reused across queue changes (and the
            // testcase-based invalidation path must write under the same key).
            const queueId = get(activeQueueIdAtom) ?? ""
            const projectId = get(projectIdAtom)
            return {
                queryKey: [
                    "scenarioAnnotationsByTestcase",
                    scenarioId,
                    testcaseId,
                    queueId,
                    projectId ?? "",
                ],
                queryFn: async (): Promise<Annotation[]> => {
                    if (!projectId || !testcaseId) return []
                    const response = await queryAnnotations({
                        projectId,
                        annotation: {
                            references: {
                                testcase: {id: testcaseId},
                            },
                        },
                    })
                    // A query by testcase id returns annotations from EVERY queue
                    // that ever touched this testcase (and archived revisions).
                    // Scope to the active queue so a fresh queue doesn't surface
                    // stale annotations from prior queues.
                    return filterQueueScopedAnnotations(response.annotations ?? [], queueId)
                },
                enabled: !!testcaseId,
                retry: (failureCount: number, error: Error) => {
                    if (error?.message === "projectId not yet available" && failureCount < 5) {
                        return true
                    }
                    return false
                },
                retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
                staleTime: 30_000,
            }
        }),
    (a: {scenarioId: string; testcaseId: string}, b: {scenarioId: string; testcaseId: string}) =>
        a.scenarioId === b.scenarioId && a.testcaseId === b.testcaseId,
)

/**
 * Resolved annotations for a scenario.
 *
 * Uses two resolution paths:
 * 1. **Step-based** (primary): Extract annotation trace_ids from evaluation run step results.
 *    This is the canonical path — step results are per-scenario and per-run, so they
 *    always return the correct annotations.
 * 2. **Testcase-based** (fallback): Query annotations by testcase reference (for testcase queues).
 *
 * Link-based resolution (query by invocation trace_id) was intentionally removed because
 * it finds ALL annotations linked to a trace across all queues/runs/scenarios, causing
 * cross-queue bleed, cross-scenario bleed, and 500 errors on submit.
 * Step result upserts are now awaited (not fire-and-forget) to ensure path 1 always works.
 */
export const scenarioAnnotationsAtomFamily = atomFamily((scenarioId: string) =>
    atom<Annotation[]>((get) => {
        // Path 1: Step-based resolution (primary)
        const traceIds = get(scenarioAnnotationTraceIdsAtomFamily(scenarioId))
        if (traceIds.length > 0) {
            const annotationTraceIds = traceIds.join("|")
            const query = get(scenarioAnnotationsQueryAtomFamily({scenarioId, annotationTraceIds}))
            return query.data ?? []
        }

        // Path 2: Testcase-based resolution (for testcase queues without trace_id)
        const testcaseRef = get(scenarioTestcaseRefAtomFamily(scenarioId))
        if (testcaseRef.testcaseId) {
            const testcaseQuery = get(
                scenarioAnnotationsByTestcaseQueryAtomFamily({
                    scenarioId,
                    testcaseId: testcaseRef.testcaseId,
                }),
            )
            return testcaseQuery.data ?? []
        }

        return []
    }),
)

export const scenarioAnnotationsQueryStateAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const traceIds = get(scenarioAnnotationTraceIdsAtomFamily(scenarioId))
        if (traceIds.length > 0) {
            const annotationTraceIds = traceIds.join("|")
            return get(scenarioAnnotationsQueryAtomFamily({scenarioId, annotationTraceIds}))
        }

        const testcaseRef = get(scenarioTestcaseRefAtomFamily(scenarioId))
        if (testcaseRef.testcaseId) {
            return get(
                scenarioAnnotationsByTestcaseQueryAtomFamily({
                    scenarioId,
                    testcaseId: testcaseRef.testcaseId,
                }),
            )
        }

        return null
    }),
)

// ============================================================================
// EVALUATION METRICS (per-scenario)
// ============================================================================

/**
 * Per-scenario metrics query — delegates to the evaluations engine's generic
 * metrics query family. Yields the same TanStack query object so existing
 * consumers (which read `.data`/`.refetch`) keep working.
 */
const scenarioMetricsQueryAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const runId = get(activeRunIdAtom)
        const projectId = get(projectIdAtom)
        return get(
            scenarioDataSelectors.scenarioMetricsQuery({
                projectId: projectId ?? "",
                runId: runId ?? "",
                scenarioId,
            }),
        )
    }),
)

/**
 * Resolved metrics data for a scenario.
 * Returns the flat + raw metric data (or null if not loaded).
 */
const scenarioMetricsAtomFamily = atomFamily((scenarioId: string) =>
    atom<ScenarioMetricData | null>((get) => {
        const runId = get(activeRunIdAtom)
        const projectId = get(projectIdAtom)
        if (!runId || !projectId || !scenarioId) return null
        return get(scenarioDataSelectors.scenarioMetrics({projectId, runId, scenarioId}))
    }),
)

// ============================================================================
// COMPOUND SELECTORS (convenience accessors for common composite patterns)
// ============================================================================

// ScenarioEvaluatorKey imported from ../types

function serializeScenarioEvaluatorKey(key: ScenarioEvaluatorKey): string {
    return `${key.scenarioId}|${key.evaluatorId ?? ""}|${key.evaluatorSlug ?? ""}|${key.path ?? ""}|${key.stepKey ?? ""}`
}

/**
 * Find the annotation for a specific evaluator within a scenario's annotations.
 * Matches by evaluator slug or evaluator ID.
 */
const scenarioAnnotationByEvaluatorAtomFamily = atomFamily(
    (key: ScenarioEvaluatorKey) =>
        atom<Annotation | null>((get) => {
            const annotations = get(scenarioAnnotationsAtomFamily(key.scenarioId))
            if (!annotations?.length) return null

            if (get(queueKindAtom) === "testcases") {
                const queueId = get(activeQueueIdAtom)
                const evaluatorSlug =
                    key.evaluatorSlug ??
                    get(testsetSyncEvaluatorsAtom).find(
                        (evaluator) => evaluator.workflowId === key.evaluatorId,
                    )?.slug
                if (!queueId || !evaluatorSlug) return null

                const selection = selectQueueScopedAnnotation({
                    annotations,
                    queueId,
                    evaluatorSlug,
                    evaluatorWorkflowId: key.evaluatorId,
                })

                return selection.annotation
            }

            return (
                annotations.find((ann) => {
                    const ref = ann.references?.evaluator
                    if (!ref) return false
                    if (key.evaluatorSlug && ref.slug === key.evaluatorSlug) return true
                    if (key.evaluatorId && ref.id === key.evaluatorId) return true
                    return false
                }) ?? null
            )
        }),
    (a: ScenarioEvaluatorKey, b: ScenarioEvaluatorKey) =>
        serializeScenarioEvaluatorKey(a) === serializeScenarioEvaluatorKey(b),
)

/**
 * Resolve a value from an annotation's outputs using a path.
 * Strips common prefixes (attributes.ag.data.outputs., data.outputs., outputs.)
 * and walks the path to extract the nested value.
 */
function resolveAnnotationOutputValue(
    annotation: Annotation,
    path: string | null | undefined,
): unknown {
    const outputs = annotation.data?.outputs
    if (!outputs) return null

    if (!path) return outputs

    let relativePath = path
    for (const prefix of ["attributes.ag.data.outputs.", "data.outputs.", "outputs."]) {
        if (relativePath.startsWith(prefix)) {
            relativePath = relativePath.slice(prefix.length)
            break
        }
    }

    if (!relativePath || relativePath === "outputs") return outputs

    const parts = relativePath.split(".")
    let current: unknown = outputs
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== "object") return null
        current = (current as Record<string, unknown>)[part]
    }
    return current ?? null
}

/**
 * Full metric resolution for an evaluator in a scenario.
 * Combines: annotation lookup → annotation value extraction → metric fallback → stats resolution.
 *
 * This replaces the pattern where each cell component independently:
 * 1. Gets annotations
 * 2. Gets metrics
 * 3. Finds annotation by evaluator
 * 4. Resolves annotation value OR metric value
 * 5. Resolves stats
 *
 * Now all 5 operations are encapsulated in a single reactive atom.
 */
// ScenarioMetricForEvaluator imported from ../types

const scenarioMetricForEvaluatorAtomFamily = atomFamily(
    (key: ScenarioEvaluatorKey) =>
        atom<ScenarioMetricForEvaluator>((get) => {
            const annotation = get(scenarioAnnotationByEvaluatorAtomFamily(key))
            const metrics = get(scenarioMetricsAtomFamily(key.scenarioId))

            // Try annotation value first
            let value: unknown = undefined
            if (annotation) {
                const annValue = key.path
                    ? resolveAnnotationOutputValue(annotation, key.path)
                    : (annotation.data?.outputs ?? null)
                if (annValue !== null && annValue !== undefined) {
                    value = annValue
                }
            }

            // Fall back to metric value if annotation didn't provide one
            if (value === undefined) {
                value = resolveMetricValue(
                    metrics,
                    key.path ?? null,
                    key.stepKey ?? null,
                    key.evaluatorSlug ?? null,
                )
            }

            // Resolve stats
            const stats = resolveMetricStats(
                metrics,
                key.path ?? null,
                key.stepKey ?? null,
                key.evaluatorSlug ?? null,
            )

            return {value, stats, annotation}
        }),
    (a: ScenarioEvaluatorKey, b: ScenarioEvaluatorKey) =>
        serializeScenarioEvaluatorKey(a) === serializeScenarioEvaluatorKey(b),
)

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate the annotation query cache for a specific scenario.
 * Called after annotation submission so the table cells refresh.
 *
 * Uses sequential ordering to avoid race conditions:
 * 1. Refetch scenario steps (awaited) — discovers new annotation trace_ids
 * 2. Refetch annotation queries (awaited) — uses fresh trace_ids from step 1
 * 3. Refresh metrics (fire-and-forget) — independent, can run in background
 */
async function invalidateScenarioAnnotations(
    scenarioId: string,
    fallbackAnnotations: Annotation[] = [],
) {
    const store = getStore()
    const runId = store.get(activeRunIdAtom)
    const projectId = store.get(projectIdAtom)
    let freshSteps: EvaluationResult[] | null = null

    // Step 1: Refetch scenario steps FIRST (awaited).
    // The new annotation creates a new step result with the annotation's trace_id.
    // We must wait for this to complete so scenarioAnnotationTraceIdsAtomFamily
    // derives the correct trace IDs for step 2.
    if (projectId && runId) {
        try {
            freshSteps = await queryEvaluationResults({
                projectId,
                runId,
                scenarioIds: [scenarioId],
            })
            queryClient.setQueryData(["scenarioSteps", projectId, runId, scenarioId], freshSteps)
        } catch {
            freshSteps = null
        }
    }

    if (projectId && runId && !freshSteps) {
        const stepsQuery = store.get(
            evaluationRunMolecule.selectors.scenarioSteps({projectId, runId, scenarioId}),
        )
        if (stepsQuery?.refetch) {
            try {
                const result = await stepsQuery.refetch()
                freshSteps = Array.isArray(result.data) ? result.data : null
            } catch {
                // Non-critical — fallback link-based query will catch these
            }
        }
    }

    // Step 2: Refetch annotation queries (awaited).
    // Now that steps are updated, scenarioAnnotationTraceIdsAtomFamily has fresh data.
    const annotationSteps =
        runId && projectId
            ? store.get(evaluationRunMolecule.selectors.annotationSteps({projectId, runId}))
            : []
    const traceIds =
        freshSteps && annotationSteps.length > 0
            ? extractAnnotationTraceIdsFromSteps({annotationSteps, steps: freshSteps})
            : store.get(scenarioAnnotationTraceIdsAtomFamily(scenarioId))

    if (projectId && traceIds.length > 0) {
        const annotationTraceIds = traceIds.join("|")
        try {
            const response = await queryAnnotations({
                projectId,
                annotationLinks: traceIds.map((traceId) => ({trace_id: traceId})),
            })
            const annotations = mergeAnnotationsByTraceSpan(
                response.annotations ?? [],
                fallbackAnnotations,
            )
            queryClient.setQueryData(
                ["scenarioAnnotations", scenarioId, annotationTraceIds],
                annotations,
            )
        } catch {
            const query = store.get(
                scenarioAnnotationsQueryAtomFamily({scenarioId, annotationTraceIds}),
            )
            if (query?.refetch) {
                try {
                    await query.refetch()
                } catch {
                    // Will fall through to link-based query
                }
            }
        }
    } else if (projectId) {
        const testcaseRef = store.get(scenarioTestcaseRefAtomFamily(scenarioId))
        if (testcaseRef.testcaseId) {
            try {
                const response = await queryAnnotations({
                    projectId,
                    annotation: {
                        references: {
                            testcase: {id: testcaseRef.testcaseId},
                        },
                    },
                })
                // Scope to the active queue before seeding the cache — a
                // testcase-id query returns every queue's annotations, so an
                // unfiltered write here would reintroduce cross-queue bleed
                // after submit. Write under the same queue/project-scoped key
                // as scenarioAnnotationsByTestcaseQueryAtomFamily.
                const queueId = store.get(activeQueueIdAtom) ?? ""
                const annotations = mergeAnnotationsByTraceSpan(
                    filterQueueScopedAnnotations(response.annotations ?? [], queueId),
                    fallbackAnnotations,
                )
                queryClient.setQueryData(
                    [
                        "scenarioAnnotationsByTestcase",
                        scenarioId,
                        testcaseRef.testcaseId,
                        queueId,
                        projectId ?? "",
                    ],
                    annotations,
                )
            } catch {
                const query = store.get(
                    scenarioAnnotationsByTestcaseQueryAtomFamily({
                        scenarioId,
                        testcaseId: testcaseRef.testcaseId,
                    }),
                )
                if (query?.refetch) {
                    try {
                        await query.refetch()
                    } catch {
                        // Non-critical — callers still invalidate broader annotation caches.
                    }
                }
            }
        }
    }

    // Step 3: Trigger metrics refresh then refetch (fire-and-forget, independent)
    if (projectId && runId) {
        axios
            .post(
                `/evaluations/metrics/refresh`,
                {metrics: {run_id: runId, scenario_id: scenarioId}},
                {params: {project_id: projectId}},
            )
            .then(() => {
                const metricsQuery = store.get(scenarioMetricsQueryAtomFamily(scenarioId))
                if (metricsQuery?.refetch) {
                    metricsQuery.refetch()
                }
            })
            .catch((err: unknown) => {
                console.warn("[annotationSession] Metrics refresh failed:", err)
            })
    }
}

// ============================================================================
// ACTIONS (Write Atoms)
// ============================================================================

/**
 * Open a queue for annotation.
 * Registers a type hint and sets up the session state.
 */
const openQueueAtom = atom(null, (get, set, payload: OpenQueuePayload) => {
    const {queueId, queueType, initialView, initialScenarioId} = payload

    // Register type hint for the queue controller
    registerQueueTypeHint(queueId, queueType)

    // Queue lifecycle (annotation-owned)
    set(activeQueueIdAtom, queueId)
    set(activeQueueTypeAtom, queueType)

    // Hand the session over to the generic engine: bind run/project + reset session state,
    // and inject the QUEUE scenario source (user-scoped) reactively — the engine reads
    // through these atom refs, so queue refetches flow in with no effects.
    const projectId = get(projectIdAtom)
    const runId = get(simpleQueueMolecule.selectors.runId(queueId))
    set(sessionEngine.actions.openSession, {
        projectId: projectId ?? "",
        runId,
        initialView,
        initialScenarioId,
    })
    set(sessionEngine.actions.setScenarioSource, {
        scenarios: simpleQueueMolecule.selectors.scenarios(queueId),
        query: simpleQueueMolecule.selectors.scenariosQuery(queueId) as never,
        // Inject the queue kind ("traces" | "testcases") reactively so the engine's
        // list-column tier shapes trace- vs testcase-based columns. The engine reads
        // through this atom ref, so kind changes flow in with no effects.
        kind: queueKindAtom,
    })

    // Notify callback
    _onQueueOpened?.(queueId, queueType)
})

// Navigation + completion delegate to the engine.
const navigateNextAtom = sessionEngine.actions.navigateNext
const navigatePrevAtom = sessionEngine.actions.navigatePrev
const navigateToIndexAtom = sessionEngine.actions.navigateToIndex
const markCompletedAtom = sessionEngine.actions.markCompleted

// Remaining session actions delegate to the engine.
const completeAndAdvanceAtom = sessionEngine.actions.completeAndAdvance
const setActiveViewAtom = sessionEngine.actions.setActiveView
const setHideCompletedInFocusAtom = sessionEngine.actions.setHideCompletedInFocus
const setFocusAutoNextAtom = sessionEngine.actions.setFocusAutoNext
const applyRouteStateAtom = sessionEngine.actions.applyRouteState

const closeSessionAtom = atom(null, (get, set) => {
    const queueId = get(activeQueueIdAtom)

    // Clear type hint
    if (queueId) {
        clearQueueTypeHint(queueId)
    }

    // Queue lifecycle (annotation-owned)
    set(activeQueueIdAtom, null)
    set(activeQueueTypeAtom, null)

    // Engine tears down session state + scenario source.
    set(sessionEngine.actions.closeSession)

    // Annotation-specific UI state
    set(addToTestsetModalOpenAtom, false)
    set(addToTestsetScopeAtom, "all")
    set(addToTestsetScenarioIdsAtom, [])
    set(pendingTestsetSelectionAtom, null)
    set(pendingTestsetSelectionNameAtom, null)
    set(selectedScenarioIdsAtom, [])
    set(addToTestsetExportJobAtom, {
        id: "",
        status: "idle",
        total: 0,
        processed: 0,
    })

    // Notify callback
    _onSessionClosed?.()
})

// ============================================================================
// IMPERATIVE API
// ============================================================================

export function getStore() {
    return getDefaultStore()
}

// ============================================================================
// SIDE-EFFECT CALLBACKS
// ============================================================================

// Annotation-owned callbacks (fired in annotation's own open/close actions).
let _onQueueOpened: ((queueId: string, queueType: QueueType) => void) | null = null
let _onSessionClosed: (() => void) | null = null
// onNavigate / onAnnotationSubmitted are forwarded to the engine (navigation + complete
// are delegated to it) — see registerAnnotationCallbacks.

/**
 * Register callbacks for annotation session side-effects.
 * Used by platform-specific code (OSS/EE) to react to session events.
 *
 * @example
 * ```typescript
 * registerAnnotationCallbacks({
 *     onQueueOpened: (queueId) => router.push(`/annotations/${queueId}`),
 *     onSessionClosed: () => router.push('/annotations'),
 * })
 * ```
 */
export function registerAnnotationCallbacks(callbacks: AnnotationSessionCallbacks) {
    _onQueueOpened = callbacks.onQueueOpened ?? null
    _onSessionClosed = callbacks.onSessionClosed ?? null
    // Navigation + completion run in the engine — forward those hooks to it.
    registerEngineCallbacks({
        onNavigate: callbacks.onNavigate,
        onSubmitted: callbacks.onAnnotationSubmitted,
    })
}

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

/**
 * Annotation session controller — orchestrates the annotation workflow.
 *
 * Follows the same controller pattern as `playgroundController`.
 */
export const annotationSessionController = {
    // ========================================================================
    // SELECTORS (return atoms for reactive subscriptions)
    // ========================================================================
    selectors: {
        /** Is a session currently active? */
        isActive: () => isActiveAtom,
        /** The active queue ID */
        activeQueueId: () => activeQueueIdAtom,
        /** The active queue type */
        activeQueueType: () => activeQueueTypeAtom,
        /** The evaluation run ID associated with the queue */
        activeRunId: () => activeRunIdAtom,
        /** Current scenario ID */
        currentScenarioId: () => currentScenarioIdAtom,
        /** Current scenario index (0-based) */
        currentScenarioIndex: () => currentScenarioIndexAtom,
        /** Requested/focused scenario ID from route or navigation state */
        focusedScenarioId: () => focusedScenarioIdAtom,
        /** All scenario IDs */
        scenarioIds: () => scenarioIdsAtom,
        /** Scenario IDs currently visible in annotate focus view */
        focusScenarioIds: () => navigableScenarioIdsAtom,
        /** Progress (total, completed, remaining, currentIndex) */
        progress: () => progressAtom,
        /** Can navigate forward? */
        hasNext: () => hasNextAtom,
        /** Can navigate backward? */
        hasPrev: () => hasPrevAtom,
        /** Whether completed scenarios are hidden in annotate focus view */
        hideCompletedInFocus: () => hideCompletedInFocusAtom,
        /** Whether complete action auto-advances in annotate focus view */
        focusAutoNext: () => focusAutoNextAtom,
        /** Is the current scenario already completed? */
        isCurrentCompleted: () => isCurrentCompletedAtom,
        /** Scenario statuses with local completed overlay */
        scenarioStatuses: () => scenarioStatusesAtom,
        /** Queue name */
        queueName: () => queueNameAtom,
        /** Queue kind (traces / testcases) */
        queueKind: () => queueKindAtom,
        /** Queue description */
        queueDescription: () => queueDescriptionAtom,
        /** Default target testset name for add-to-testset flows */
        defaultTargetTestsetName: () => defaultTargetTestsetNameAtom,
        /** Current pending target testset selection */
        pendingTestsetSelection: () => pendingTestsetSelectionAtom,
        /** Current pending target testset name */
        pendingTestsetSelectionName: () => pendingTestsetSelectionNameAtom,
        /** Add-to-testset modal open state */
        isAddToTestsetModalOpen: () => addToTestsetModalOpenAtom,
        /** Scenario IDs selected in the all-annotations table */
        selectedScenarioIds: () => selectedScenarioIdsAtom,
        /** Current add-to-testset background export job */
        addToTestsetExportJob: () => addToTestsetExportJobAtom,
        /** Whether an add-to-testset export is currently running */
        isAddToTestsetExporting: () => isAddToTestsetExportingAtom,
        /** Whether the current session has exportable data */
        canAddToTestset: () => canAddToTestsetAtom,
        /** Evaluator workflow IDs from evaluation run annotation steps */
        evaluatorIds: () => evaluatorIdsAtom,
        /** Evaluator revision IDs from evaluation run annotation steps */
        evaluatorRevisionIds: () => evaluatorRevisionIdsAtom,
        /** Ordered evaluator refs from evaluation run annotation steps */
        evaluatorStepRefs: () => evaluatorStepRefsAtom,
        /** Annotation column definitions derived from run mappings + steps */
        annotationColumnDefs: () => annotationColumnDefsAtom,
        /** Trace input keys discovered from the first scenario's trace data */
        traceInputKeys: () => traceInputKeysAtom,
        /** Testcase input keys discovered from the first scenario's testcase data */
        testcaseInputKeys: () => testcaseInputKeysAtom,
        /** Testcase data query (fetched by testcaseId) */
        testcaseData: testcaseDataAtomFamily,
        /** Full list of column definitions for the scenario list table */
        listColumnDefs: () => listColumnDefsAtom,
        /** Full scenario records (for cell rendering) */
        scenarioRecords: () => scenarioRecordsAtom,
        /** Scenarios query state (loading, error) */
        scenariosQuery: () => scenariosQueryAtom,
        /** Active session view ("list" | "annotate") */
        activeView: () => activeSessionViewAtom,
        /** Trace ref (traceId, spanId) for a scenario */
        scenarioTraceRef: scenarioTraceRefAtomFamily,
        /** Full evaluation step-results query state for a scenario */
        scenarioStepsQuery: scenarioStepsQueryStateAtomFamily,
        /** Testcase ref (testcaseId) for a scenario */
        scenarioTestcaseRef: scenarioTestcaseRefAtomFamily,
        /** Full trace query state for a scenario */
        scenarioTraceQuery: scenarioTraceQueryAtomFamily,
        /** Root span for a scenario */
        scenarioRootSpan: scenarioRootSpanAtomFamily,
        /** Annotations for a scenario */
        scenarioAnnotations: scenarioAnnotationsAtomFamily,
        /** Full annotations query state for a scenario */
        scenarioAnnotationsQuery: scenarioAnnotationsQueryStateAtomFamily,
        /** Evaluation metrics for a scenario (from /evaluations/metrics/query) */
        scenarioMetrics: scenarioMetricsAtomFamily,
        /** Full metrics query state for a scenario */
        scenarioMetricsQuery: scenarioMetricsQueryAtomFamily,
        /** Find annotation for a specific evaluator in a scenario */
        scenarioAnnotationByEvaluator: scenarioAnnotationByEvaluatorAtomFamily,
        /** Full metric resolution (value + stats + annotation) for an evaluator in a scenario */
        scenarioMetricForEvaluator: scenarioMetricForEvaluatorAtomFamily,
        /** Whether the session can sync to testset (testcase queue + ≥1 completed) */
        canSyncToTestset: () => canSyncToTestsetAtom,
    },

    // ========================================================================
    // ACTIONS (write atoms for state mutations)
    // ========================================================================
    actions: {
        /** Open a queue for annotation */
        openQueue: openQueueAtom,
        /** Navigate to next scenario */
        navigateNext: navigateNextAtom,
        /** Navigate to previous scenario */
        navigatePrev: navigatePrevAtom,
        /** Navigate to specific index */
        navigateToIndex: navigateToIndexAtom,
        /** Stabilize scenario order for the current session */
        syncScenarioOrder: syncScenarioOrderAtom,
        /** Hide or show completed scenarios in annotate focus view */
        setHideCompletedInFocus: setHideCompletedInFocusAtom,
        /** Enable or disable auto-next in annotate focus view */
        setFocusAutoNext: setFocusAutoNextAtom,
        /** Mark a scenario as completed */
        markCompleted: markCompletedAtom,
        /** Mark current as completed and advance */
        completeAndAdvance: completeAndAdvanceAtom,
        /** Close the annotation session */
        closeSession: closeSessionAtom,
        /** Set the active view ("list" | "annotate") */
        setActiveView: setActiveViewAtom,
        /** Apply route state ("view" and "scenarioId") */
        applyRouteState: applyRouteStateAtom,
        /** Sync testcase annotations back into one or more testsets */
        syncToTestsets: syncToTestsetsAtom,
        /** Open the add-to-testset commit modal */
        openAddToTestsetModal: openAddToTestsetModalAtom,
        /** Close the add-to-testset commit modal */
        closeAddToTestsetModal: closeAddToTestsetModalAtom,
        /** Set the pending target testset selected in the modal */
        setPendingTestsetSelection: setPendingTestsetSelectionAtom,
        /** Set selected rows in the all-annotations table */
        setSelectedScenarioIds: setSelectedScenarioIdsAtom,
        /** Start a background add-to-testset export job */
        addScenariosToTestset: addScenariosToTestsetAtom,
    },

    // ========================================================================
    // GET (imperative read API)
    // ========================================================================
    get: {
        isActive: () => getStore().get(isActiveAtom),
        activeQueueId: () => getStore().get(activeQueueIdAtom),
        activeQueueType: () => getStore().get(activeQueueTypeAtom),
        activeRunId: () => getStore().get(activeRunIdAtom),
        currentScenarioId: () => getStore().get(currentScenarioIdAtom),
        currentScenarioIndex: () => getStore().get(currentScenarioIndexAtom),
        focusedScenarioId: () => getStore().get(focusedScenarioIdAtom),
        scenarioIds: () => getStore().get(scenarioIdsAtom),
        focusScenarioIds: () => getStore().get(navigableScenarioIdsAtom),
        progress: () => getStore().get(progressAtom),
        hasNext: () => getStore().get(hasNextAtom),
        hasPrev: () => getStore().get(hasPrevAtom),
        hideCompletedInFocus: () => getStore().get(hideCompletedInFocusAtom),
        focusAutoNext: () => getStore().get(focusAutoNextAtom),
        queueName: () => getStore().get(queueNameAtom),
        queueKind: () => getStore().get(queueKindAtom),
        queueDescription: () => getStore().get(queueDescriptionAtom),
        defaultTargetTestsetName: () => getStore().get(defaultTargetTestsetNameAtom),
        pendingTestsetSelection: () => getStore().get(pendingTestsetSelectionAtom),
        pendingTestsetSelectionName: () => getStore().get(pendingTestsetSelectionNameAtom),
        isAddToTestsetModalOpen: () => getStore().get(addToTestsetModalOpenAtom),
        selectedScenarioIds: () => getStore().get(selectedScenarioIdsAtom),
        addToTestsetExportJob: () => getStore().get(addToTestsetExportJobAtom),
        isAddToTestsetExporting: () => getStore().get(isAddToTestsetExportingAtom),
        canAddToTestset: () => getStore().get(canAddToTestsetAtom),
        scenarioStatuses: () => getStore().get(scenarioStatusesAtom),
        evaluatorIds: () => getStore().get(evaluatorIdsAtom),
        evaluatorRevisionIds: () => getStore().get(evaluatorRevisionIdsAtom),
        evaluatorStepRefs: () => getStore().get(evaluatorStepRefsAtom),
        annotationColumnDefs: () => getStore().get(annotationColumnDefsAtom),
        traceInputKeys: () => getStore().get(traceInputKeysAtom),
        testcaseInputKeys: () => getStore().get(testcaseInputKeysAtom),
        testcaseData: (testcaseId: string) => getStore().get(testcaseDataAtomFamily(testcaseId)),
        listColumnDefs: () => getStore().get(listColumnDefsAtom),
        scenarioRecords: () => getStore().get(scenarioRecordsAtom),
        scenariosQuery: () => getStore().get(scenariosQueryAtom),
        activeView: () => getStore().get(activeSessionViewAtom),
        scenarioTraceRef: (scenarioId: string) =>
            getStore().get(scenarioTraceRefAtomFamily(scenarioId)),
        scenarioStepsQuery: (scenarioId: string) =>
            getStore().get(scenarioStepsQueryStateAtomFamily(scenarioId)),
        scenarioTestcaseRef: (scenarioId: string) =>
            getStore().get(scenarioTestcaseRefAtomFamily(scenarioId)),
        scenarioRootSpan: (scenarioId: string) =>
            getStore().get(scenarioRootSpanAtomFamily(scenarioId)),
        scenarioAnnotations: (scenarioId: string) =>
            getStore().get(scenarioAnnotationsAtomFamily(scenarioId)),
        scenarioAnnotationsQuery: (scenarioId: string) =>
            getStore().get(scenarioAnnotationsQueryStateAtomFamily(scenarioId)),
        scenarioMetrics: (scenarioId: string) =>
            getStore().get(scenarioMetricsAtomFamily(scenarioId)),
        scenarioMetricsQuery: (scenarioId: string) =>
            getStore().get(scenarioMetricsQueryAtomFamily(scenarioId)),
        scenarioAnnotationByEvaluator: (key: ScenarioEvaluatorKey) =>
            getStore().get(scenarioAnnotationByEvaluatorAtomFamily(key)),
        scenarioMetricForEvaluator: (key: ScenarioEvaluatorKey) =>
            getStore().get(scenarioMetricForEvaluatorAtomFamily(key)),
        canSyncToTestset: () => getStore().get(canSyncToTestsetAtom),
    },

    // ========================================================================
    // SET (imperative write API)
    // ========================================================================
    set: {
        openQueue: (payload: OpenQueuePayload) => getStore().set(openQueueAtom, payload),
        navigateNext: () => getStore().set(navigateNextAtom),
        navigatePrev: () => getStore().set(navigatePrevAtom),
        navigateToIndex: (index: number) => getStore().set(navigateToIndexAtom, index),
        syncScenarioOrder: () => getStore().set(syncScenarioOrderAtom),
        setHideCompletedInFocus: (hideCompleted: boolean) =>
            getStore().set(setHideCompletedInFocusAtom, hideCompleted),
        setFocusAutoNext: (autoNext: boolean) => getStore().set(setFocusAutoNextAtom, autoNext),
        markCompleted: (scenarioId: string) => getStore().set(markCompletedAtom, scenarioId),
        completeAndAdvance: () => getStore().set(completeAndAdvanceAtom),
        closeSession: () => getStore().set(closeSessionAtom),
        setActiveView: (view: SessionView) => getStore().set(setActiveViewAtom, view),
        applyRouteState: (payload: ApplyRouteStatePayload) =>
            getStore().set(applyRouteStateAtom, payload),
        syncToTestsets: () => getStore().set(syncToTestsetsAtom),
        openAddToTestsetModal: (payload: {scope: AddToTestsetScope; scenarioIds?: string[]}) =>
            getStore().set(openAddToTestsetModalAtom, payload),
        closeAddToTestsetModal: () => getStore().set(closeAddToTestsetModalAtom),
        setPendingTestsetSelection: (payload: {
            testsetId: string | null
            testsetName?: string | null
        }) => getStore().set(setPendingTestsetSelectionAtom, payload),
        setSelectedScenarioIds: (scenarioIds: string[]) =>
            getStore().set(setSelectedScenarioIdsAtom, scenarioIds),
        addScenariosToTestset: (payload: AddScenariosToTestsetPayload) =>
            getStore().set(addScenariosToTestsetAtom, payload),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        /** Invalidate annotation query for a scenario (after submission) */
        invalidateScenarioAnnotations,
    },

    // ========================================================================
    // UTILS (metric value resolution)
    // ========================================================================
    utils: {
        /** Resolve a metric value from scenario metrics data */
        resolveMetricValue,
        /** Resolve full stats object for distribution bar rendering */
        resolveMetricStats,
    },
}

export type AnnotationSessionController = typeof annotationSessionController
