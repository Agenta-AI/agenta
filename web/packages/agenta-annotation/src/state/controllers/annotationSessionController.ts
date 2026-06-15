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
import {fetchTestcasesBatch, SYSTEM_FIELDS} from "@agenta/entities/testcase"
import type {Testcase} from "@agenta/entities/testcase"
import {
    createTestset,
    fetchLatestRevision,
    fetchLatestRevisionsBatch,
    fetchRevisionWithTestcases,
    fetchTestsetsBatch,
    patchRevision,
} from "@agenta/entities/testset"
import {
    traceEntityAtomFamily,
    traceInputsAtomFamily,
    traceOutputsAtomFamily,
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
import {axios, getAgentaApiUrl, queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {atom, type Getter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    buildAddToTestsetOperations,
    buildTestcaseExportRows,
    buildTraceTestsetRows,
    buildTestsetSyncOperations,
    buildTestsetSyncPreview,
    filterQueueScopedAnnotations,
    getTestcaseDedupId,
    getTestsetSyncEvaluatorColumnKey,
    remapTargetRowsToBaseRevision,
    selectQueueScopedAnnotation,
    type CompletedScenarioRef,
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

// ============================================================================
// CORE ATOMS
// ============================================================================

/** The active queue ID being annotated */
const activeQueueIdAtom = atom<string | null>(null)

/** The active queue's type (simple or evaluation) */
const activeQueueTypeAtom = atom<QueueType | null>(null)

/** The evaluation run ID — derived from queue data via simpleQueueMolecule */
const activeRunIdAtom = atom<string | null>((get) => {
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
const scenarioRecordsAtom = atom<ScenarioRecord[]>(
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
const scenarioIdsAtom = sessionEngine.selectors.scenarioIds()
const scenariosQueryAtom = sessionEngine.selectors.scenariosQuery()
const activeSessionViewAtom = sessionEngine.selectors.activeView()
const hideCompletedInFocusAtom = sessionEngine.selectors.hideCompletedInFocus()
const focusAutoNextAtom = sessionEngine.selectors.focusAutoNext()
const completedScenarioIdsAtom = sessionEngine.selectors.completedScenarioIds()

/** Completed (locally or server-side) — used by the add-to-testset "complete" scope. */
function isScenarioCompleted(
    id: string,
    completed: Set<string>,
    records: Record<string, unknown>[],
): boolean {
    if (completed.has(id)) return true
    const record = records.find((r) => r.id === id)
    return record?.status === "success"
}

export type AddToTestsetScope = "single" | "selected" | "all" | "complete"

export interface AddToTestsetExportJob {
    id: string
    status: "idle" | "preparing" | "committing" | "success" | "error"
    total: number
    processed: number
    targetTestsetId?: string
    targetRevisionId?: string
    targetTestsetName?: string
    error?: string
}

interface AddScenariosToTestsetPayload {
    targetMode: "existing" | "new"
    commitMessage: string
    newTestsetName?: string
    newTestsetSlug?: string
}

const lastUsedTestsetByProjectAtom = atom<Record<string, string | null>>({})

const lastUsedTestsetIdAtom = atom(
    (get) => {
        const projectId = get(projectIdAtom)
        if (!projectId) return null
        return get(lastUsedTestsetByProjectAtom)[projectId] ?? null
    },
    (get, set, testsetId: string | null) => {
        const projectId = get(projectIdAtom)
        if (!projectId) return
        const byProject = get(lastUsedTestsetByProjectAtom)
        set(lastUsedTestsetByProjectAtom, {...byProject, [projectId]: testsetId})
    },
)

const defaultTargetTestsetQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    const testsetId = get(lastUsedTestsetIdAtom)

    return {
        queryKey: ["annotation-default-target-testset", projectId, testsetId],
        queryFn: async () => {
            if (!projectId || !testsetId) return null
            const testsets = await fetchTestsetsBatch(projectId, [testsetId])
            return testsets.get(testsetId) ?? null
        },
        enabled: Boolean(projectId && testsetId),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    }
})

const defaultTargetTestsetNameAtom = atom<string | null>((get) => {
    const query = get(defaultTargetTestsetQueryAtom)
    return query.data?.name ?? null
})

const addToTestsetModalOpenAtom = atom<boolean>(false)
const addToTestsetScopeAtom = atom<AddToTestsetScope>("all")
const addToTestsetScenarioIdsAtom = atom<string[]>([])
const pendingTestsetSelectionAtom = atom<string | null>(null)
const pendingTestsetSelectionNameAtom = atom<string | null>(null)
const selectedScenarioIdsAtom = atom<string[]>([])
const addToTestsetExportJobAtom = atom<AddToTestsetExportJob>({
    id: "",
    status: "idle",
    total: 0,
    processed: 0,
})

const isAddToTestsetExportingAtom = atom<boolean>((get) => {
    const status = get(addToTestsetExportJobAtom).status
    return status === "preparing" || status === "committing"
})

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
const queueNameAtom = atom<string | null>((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return null
    return get(simpleQueueMolecule.selectors.name(queueId))
})

/** Queue kind (traces / testcases) — derived from simpleQueueMolecule */
const queueKindAtom = atom<string | null>((get) => {
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
const testsetSyncEvaluatorsAtom = atom<TestsetSyncEvaluator[]>((get) => {
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
const scenarioStepsQueryStateAtomFamily = atomFamily((scenarioId: string) =>
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
const scenarioTraceRefAtomFamily = atomFamily((scenarioId: string) =>
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
const scenarioTestcaseRefAtomFamily = atomFamily((scenarioId: string) =>
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

function extractAnnotationTraceIdsFromSteps({
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
const scenarioAnnotationsAtomFamily = atomFamily((scenarioId: string) =>
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

const scenarioAnnotationsQueryStateAtomFamily = atomFamily((scenarioId: string) =>
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

function getStore() {
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

async function fetchBaseRevisionRows(params: {projectId: string; revisionId: string}) {
    // Fetch the RAW testcases — not via fetchRevisionWithTestcases.
    //
    // AGE-3761: normalizeRevision()/normalizeTestcase() strips system fields,
    // including `testcase_dedup_id`, from each row's data. The add-to-testset
    // matching (buildAddToTestsetOperations) relies on that dedup id to
    // re-identify a row by content lineage after an earlier save reassigned its
    // (immutable) testcase id. With the dedup stripped, the fallback match never
    // fired, so the second save appended the annotated row instead of replacing
    // it — duplicating it. Reading the raw rows keeps the dedup id intact.
    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/revisions/query`,
        {
            testset_revision_refs: [{id: params.revisionId}],
            windowing: {limit: 1},
        },
        {params: {project_id: params.projectId, include_testcases: true}},
    )

    const revision = response.data?.testset_revisions?.[0]
    const rawRows = revision?.data?.testcases ?? []

    return rawRows as {
        id?: string | null
        data?: Record<string, unknown> | null
    }[]
}

interface QueryStateLike {
    isPending?: boolean
    isFetching?: boolean
    data?: unknown
    error?: unknown
}

interface LatestRevisionWithRows {
    id: string
    data?: {
        testcases?: {
            id?: string | null
            data?: Record<string, unknown> | null
        }[]
    } | null
}

const TRACE_OUTPUT_COLUMN_PREFERENCES = ["correct_answer", "output", "outputs", "answer"]

function createExportJobId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isQuerySettledForExport(value: QueryStateLike | null | undefined): boolean {
    return Boolean(
        !value?.isPending && !value?.isFetching && (value?.data !== undefined || value?.error),
    )
}

function isQuerySettledOrNullForExport(value: QueryStateLike | null | undefined): boolean {
    return !value || isQuerySettledForExport(value)
}

async function waitForStoreAtomValue<T>(
    atomToWatch: unknown,
    isReady: (value: T) => boolean,
    timeoutMs = 5000,
): Promise<T> {
    const store = getStore()
    const atomRef = atomToWatch as unknown as Parameters<typeof store.get>[0]
    const subRef = atomToWatch as unknown as Parameters<typeof store.sub>[0]
    const current = store.get(atomRef) as T
    if (isReady(current)) return current

    return await new Promise<T>((resolve) => {
        const timeout = setTimeout(() => {
            unsubscribe()
            resolve(store.get(atomRef) as T)
        }, timeoutMs)

        const unsubscribe = store.sub(subRef, () => {
            const next = store.get(atomRef) as T
            if (isReady(next)) {
                clearTimeout(timeout)
                unsubscribe()
                resolve(next)
            }
        })
    })
}

function resolveScenarioIdsForAddToTestset(get: Getter): string[] {
    const scope = get(addToTestsetScopeAtom)
    const queueKind = get(queueKindAtom)

    if (queueKind === "testcases" && (scope === "all" || scope === "complete")) {
        const completed = get(completedScenarioIdsAtom)
        const records = get(scenarioRecordsAtom)
        return get(scenarioIdsAtom).filter((id) => isScenarioCompleted(id, completed, records))
    }

    if (scope === "all" || scope === "complete") {
        return get(scenarioIdsAtom)
    }
    return get(addToTestsetScenarioIdsAtom)
}

function resolveCompletedScenarioIdsForAnnotationExport(
    get: Getter,
    scenarioIds: string[],
): Set<string> {
    const completed = get(completedScenarioIdsAtom)
    const records = get(scenarioRecordsAtom)
    return new Set(scenarioIds.filter((id) => isScenarioCompleted(id, completed, records)))
}

function extractExistingColumns(
    rows: {data?: Record<string, unknown> | null}[] | null | undefined,
): Set<string> {
    const columns = new Set<string>()

    for (const row of rows ?? []) {
        collectDataColumnKeys(row.data ?? {}, columns)
    }

    return columns
}

function collectRowColumns(rows: {data: Record<string, unknown>}[]): Set<string> {
    const columns = new Set<string>()

    for (const row of rows) {
        collectDataColumnKeys(row.data, columns)
    }

    return columns
}

function getColumnLeafName(columnKey: string): string {
    return columnKey.split(".").at(-1) ?? columnKey
}

function buildColumnPathsByLeaf(columns: Set<string>): Map<string, string[]> {
    const pathsByLeaf = new Map<string, string[]>()

    for (const column of columns) {
        const leaf = getColumnLeafName(column)
        pathsByLeaf.set(leaf, [...(pathsByLeaf.get(leaf) ?? []), column])
    }

    return pathsByLeaf
}

function buildColumnLeafCounts(columns: Set<string>): Map<string, number> {
    const counts = new Map<string, number>()

    for (const column of columns) {
        const leaf = getColumnLeafName(column)
        counts.set(leaf, (counts.get(leaf) ?? 0) + 1)
    }

    return counts
}

function resolveExistingColumnPath(params: {
    exportedColumn: string
    exportedLeafCounts: Map<string, number>
    existingColumns: Set<string>
    existingPathsByLeaf: Map<string, string[]>
}): string {
    if (params.existingColumns.has(params.exportedColumn)) return params.exportedColumn

    const leaf = getColumnLeafName(params.exportedColumn)
    if ((params.exportedLeafCounts.get(leaf) ?? 0) !== 1) return params.exportedColumn

    const existingMatches = params.existingPathsByLeaf.get(leaf) ?? []
    return existingMatches.length === 1 ? existingMatches[0] : params.exportedColumn
}

function setColumnPathValue(data: Record<string, unknown>, columnPath: string, value: unknown) {
    const parts = columnPath.split(".").filter(Boolean)
    if (parts.length === 0) return

    let cursor = data
    for (let index = 0; index < parts.length - 1; index++) {
        const part = parts[index]
        const next = cursor[part]

        if (!next || typeof next !== "object" || Array.isArray(next)) {
            cursor[part] = {}
        }

        cursor = cursor[part] as Record<string, unknown>
    }

    cursor[parts[parts.length - 1]] = value
}

/**
 * Walk a row's data tree depth-first, invoking `visit(columnKey, value)` for
 * every leaf. Top-level system fields are skipped; nested plain objects are
 * recursed (arrays count as leaf values). Shared traversal behind
 * `collectColumnPathValues` (path+value) and `collectDataColumnKeys` (keys).
 */
function walkLeafColumns(
    data: Record<string, unknown>,
    visit: (columnKey: string, value: unknown) => void,
    parentKey?: string,
): void {
    for (const [key, value] of Object.entries(data)) {
        if (!parentKey && SYSTEM_FIELDS.has(key)) continue

        const columnKey = parentKey ? `${parentKey}.${key}` : key
        if (value && typeof value === "object" && !Array.isArray(value)) {
            walkLeafColumns(value as Record<string, unknown>, visit, columnKey)
            continue
        }

        visit(columnKey, value)
    }
}

function collectColumnPathValues(
    data: Record<string, unknown>,
    values: {path: string; value: unknown}[],
    parentKey?: string,
) {
    walkLeafColumns(data, (path, value) => values.push({path, value}), parentKey)
}

function remapRowsToExistingLeafColumns<T extends {data: Record<string, unknown>}>(
    rows: T[],
    existingColumns: Set<string>,
): T[] {
    if (existingColumns.size === 0) return rows

    const exportedColumns = collectRowColumns(rows)
    const exportedLeafCounts = buildColumnLeafCounts(exportedColumns)
    const existingPathsByLeaf = buildColumnPathsByLeaf(existingColumns)

    return rows.map((row) => {
        const values: {path: string; value: unknown}[] = []
        collectColumnPathValues(row.data, values)

        const data: Record<string, unknown> = {}
        for (const {path, value} of values) {
            const targetPath = resolveExistingColumnPath({
                exportedColumn: path,
                exportedLeafCounts,
                existingColumns,
                existingPathsByLeaf,
            })
            setColumnPathValue(data, targetPath, value)
        }

        return {...row, data}
    })
}

function collectDataColumnKeys(
    data: Record<string, unknown>,
    columns: Set<string>,
    parentKey?: string,
) {
    walkLeafColumns(data, (columnKey) => columns.add(columnKey), parentKey)
}

function resolveTraceOutputColumnName(params: {
    targetMode: "existing" | "new"
    existingColumns: Set<string>
}): string {
    if (params.targetMode === "new") return "outputs"

    const existingPathsByLeaf = buildColumnPathsByLeaf(params.existingColumns)

    for (const columnName of TRACE_OUTPUT_COLUMN_PREFERENCES) {
        if (params.existingColumns.has(columnName)) return columnName

        const existingMatches = existingPathsByLeaf.get(columnName) ?? []
        if (existingMatches.length === 1) return existingMatches[0]
    }

    return "output"
}

async function fetchLatestRevisionWithRows(params: {
    projectId: string
    testsetId: string
}): Promise<LatestRevisionWithRows> {
    // Resolve the latest *non-archived* revision (AGE-3761).
    //
    // The `retrieve {testset_ref}` path (fetchLatestRevisionWithTestcases)
    // returns archived revisions as "latest". Basing the add-to-testset commit
    // on an archived revision re-mutates rows whose identity the queue can no
    // longer match (the archived revision holds reassigned testcase ids), which
    // duplicates testcases. The revisions `query` path excludes archived
    // revisions, so we resolve the base revision id through it. Verified against
    // the live backend: after archiving the head revision, `retrieve` still
    // returns it while `query` (descending, limit 1) returns the prior live one.
    const latest = await fetchLatestRevision({
        projectId: params.projectId,
        testsetId: params.testsetId,
    })
    if (!latest?.id) {
        throw new Error("The latest revision for the selected testset could not be resolved.")
    }

    // Re-fetch with a 1-row sample purely for column detection.
    const latestRevision = await fetchRevisionWithTestcases({
        id: latest.id,
        projectId: params.projectId,
        testcaseLimit: 1,
    })
    if (!latestRevision?.id) {
        throw new Error("The latest revision for the selected testset could not be resolved.")
    }

    return latestRevision as LatestRevisionWithRows
}

function buildTraceAnnotationOutputs(params: {
    annotations: Annotation[]
    evaluators: TestsetSyncEvaluator[]
    queueId: string
}): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {}

    for (const evaluator of params.evaluators) {
        const selection = selectQueueScopedAnnotation({
            annotations: params.annotations,
            queueId: params.queueId,
            evaluatorSlug: evaluator.slug,
            evaluatorWorkflowId: evaluator.workflowId,
        })

        if (!selection.annotation || selection.conflictCode) continue

        const outputs = selection.annotation.data?.outputs
        if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) continue

        const columnKey = getTestsetSyncEvaluatorColumnKey({
            evaluator,
            annotation: selection.annotation,
        })
        if (!columnKey) continue

        result[columnKey] = outputs as Record<string, unknown>
    }

    return result
}

async function fetchTraceAnnotationOutputsForExport(params: {
    projectId: string
    scenarioId: string
    queueId: string
    evaluators: TestsetSyncEvaluator[]
}): Promise<Record<string, Record<string, unknown>>> {
    const store = getStore()
    const runId = store.get(activeRunIdAtom)

    if (runId) {
        const annotationSteps = store.get(
            evaluationRunMolecule.selectors.annotationSteps({projectId: params.projectId, runId}),
        )
        if (annotationSteps.length > 0) {
            const steps = await queryEvaluationResults({
                projectId: params.projectId,
                runId,
                scenarioIds: [params.scenarioId],
            })
            const annotationTraceIds = extractAnnotationTraceIdsFromSteps({
                annotationSteps,
                steps,
            })

            if (annotationTraceIds.length > 0) {
                const response = await queryAnnotations({
                    projectId: params.projectId,
                    annotationLinks: annotationTraceIds.map((traceId) => ({trace_id: traceId})),
                })

                return buildTraceAnnotationOutputs({
                    annotations: response.annotations ?? [],
                    evaluators: params.evaluators,
                    queueId: params.queueId,
                })
            }
        }
    }

    return buildTraceAnnotationOutputs({
        annotations: store.get(scenarioAnnotationsAtomFamily(params.scenarioId)),
        evaluators: params.evaluators,
        queueId: params.queueId,
    })
}

async function prepareTraceExportRows(params: {
    projectId: string
    scenarioIds: string[]
    outputColumnName: string
    queueId: string
    evaluators: TestsetSyncEvaluator[]
    requireAnnotationOutputScenarioIds: Set<string>
    setProcessed: (processed: number) => void
}) {
    const traceInputsByScenario = new Map<string, Record<string, unknown>>()
    const traceOutputsByScenario = new Map<string, unknown>()
    const annotationsByScenario = new Map<string, Record<string, Record<string, unknown>>>()
    const exportableScenarioIds: string[] = []
    let processed = 0

    for (const scenarioId of params.scenarioIds) {
        const traceRef = getStore().get(scenarioTraceRefAtomFamily(scenarioId))
        if (!traceRef.traceId) {
            processed += 1
            params.setProcessed(processed)
            continue
        }

        const traceQueryAtom = traceEntityAtomFamily(traceRef.traceId)
        const traceQuery = await waitForStoreAtomValue<QueryStateLike | null | undefined>(
            traceQueryAtom,
            isQuerySettledOrNullForExport,
        )
        if (!isQuerySettledForExport(traceQuery)) {
            throw new Error("Timed out loading trace data for export")
        }
        if (traceQuery?.error) {
            throw new Error(extractApiErrorMessage(traceQuery.error))
        }

        exportableScenarioIds.push(scenarioId)
        traceInputsByScenario.set(
            scenarioId,
            getStore().get(traceInputsAtomFamily(traceRef.traceId)) ?? {},
        )
        traceOutputsByScenario.set(
            scenarioId,
            getStore().get(traceOutputsAtomFamily(traceRef.traceId)),
        )

        const stepsQueryAtom = scenarioStepsQueryStateAtomFamily(scenarioId)
        await waitForStoreAtomValue<QueryStateLike | null | undefined>(
            stepsQueryAtom,
            isQuerySettledOrNullForExport,
        )

        const annotationsQueryAtom = scenarioAnnotationsQueryStateAtomFamily(scenarioId)
        await waitForStoreAtomValue<QueryStateLike | null | undefined>(
            annotationsQueryAtom,
            isQuerySettledOrNullForExport,
            2500,
        )

        const annotationOutputs = await fetchTraceAnnotationOutputsForExport({
            projectId: params.projectId,
            scenarioId,
            queueId: params.queueId,
            evaluators: params.evaluators,
        })

        if (
            params.requireAnnotationOutputScenarioIds.has(scenarioId) &&
            params.evaluators.length > 0 &&
            Object.keys(annotationOutputs).length === 0
        ) {
            throw new Error(
                "Could not load annotation data for one or more completed scenarios. Please try again.",
            )
        }

        annotationsByScenario.set(scenarioId, annotationOutputs)

        processed += 1
        params.setProcessed(processed)
    }

    return buildTraceTestsetRows({
        scenarioIds: exportableScenarioIds,
        traceInputsByScenario,
        traceOutputsByScenario,
        annotationsByScenario,
        outputColumnName: params.outputColumnName,
    })
}

async function prepareTestcaseExportRows(params: {
    projectId: string
    scenarioIds: string[]
    queueId: string
    evaluators: TestsetSyncEvaluator[]
    setProcessed: (processed: number) => void
}) {
    const testcaseIdByScenarioId = new Map<string, string>()
    const testcaseIds: string[] = []

    for (const scenarioId of params.scenarioIds) {
        const testcaseId = getStore().get(scenarioTestcaseRefAtomFamily(scenarioId)).testcaseId
        if (!testcaseId) continue
        testcaseIdByScenarioId.set(scenarioId, testcaseId)
        testcaseIds.push(testcaseId)
    }

    const uniqueTestcaseIds = Array.from(new Set(testcaseIds))
    const fetchedTestcases = await fetchTestcasesBatch({
        projectId: params.projectId,
        testcaseIds: uniqueTestcaseIds,
    })
    const testcasesByScenarioId = new Map<string, Testcase>()
    const annotationsByTestcaseId = new Map<string, Annotation[]>()
    let processed = 0

    for (const scenarioId of params.scenarioIds) {
        const testcaseId = testcaseIdByScenarioId.get(scenarioId)
        if (!testcaseId) {
            processed += 1
            params.setProcessed(processed)
            continue
        }

        const testcase = fetchedTestcases.get(testcaseId)
        if (testcase) {
            testcasesByScenarioId.set(scenarioId, testcase)
        }

        const response = await queryAnnotations({
            projectId: params.projectId,
            annotation: {
                references: {
                    testcase: {id: testcaseId},
                },
            },
        })
        // Scope to the active queue: a testcase-id query returns annotations
        // from every queue that touched this testcase, so without this filter
        // the export bleeds stale annotations onto rows (every row ends up
        // "annotated" even in a fresh queue).
        annotationsByTestcaseId.set(
            testcaseId,
            filterQueueScopedAnnotations(response.annotations ?? [], params.queueId),
        )

        processed += 1
        params.setProcessed(processed)
    }

    return buildTestcaseExportRows({
        scenarioIds: params.scenarioIds,
        testcasesByScenarioId,
        annotationsByTestcaseId,
        evaluators: params.evaluators,
        queueId: params.queueId,
    })
}

const openAddToTestsetModalAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            scope: AddToTestsetScope
            scenarioIds?: string[]
        },
    ) => {
        if (get(isAddToTestsetExportingAtom)) return

        set(addToTestsetScopeAtom, payload.scope)
        set(addToTestsetScenarioIdsAtom, payload.scenarioIds ?? [])
        set(pendingTestsetSelectionAtom, get(lastUsedTestsetIdAtom))
        set(pendingTestsetSelectionNameAtom, get(defaultTargetTestsetNameAtom))
        set(addToTestsetExportJobAtom, {
            id: "",
            status: "idle",
            total: 0,
            processed: 0,
        })
        set(addToTestsetModalOpenAtom, true)
    },
)

const setPendingTestsetSelectionAtom = atom(
    null,
    (_get, set, payload: {testsetId: string | null; testsetName?: string | null}) => {
        set(pendingTestsetSelectionAtom, payload.testsetId)
        set(pendingTestsetSelectionNameAtom, payload.testsetName ?? null)
    },
)

const closeAddToTestsetModalAtom = atom(null, (_get, set) => {
    set(addToTestsetModalOpenAtom, false)
    set(pendingTestsetSelectionAtom, null)
    set(pendingTestsetSelectionNameAtom, null)
})

const setSelectedScenarioIdsAtom = atom(null, (_get, set, scenarioIds: string[]) => {
    set(selectedScenarioIdsAtom, scenarioIds)
})

const addScenariosToTestsetAtom = atom(
    null,
    async (get, set, payload: AddScenariosToTestsetPayload): Promise<{jobId: string}> => {
        if (get(isAddToTestsetExportingAtom)) {
            throw new Error("A testset export is already running")
        }

        const projectId = getStore().get(projectIdAtom)
        if (!projectId) throw new Error("No project ID")

        const queueId = get(activeQueueIdAtom)
        if (!queueId) throw new Error("No active queue")

        const scenarioIds = resolveScenarioIdsForAddToTestset(get)
        if (scenarioIds.length === 0) throw new Error("No scenarios selected for export")

        const targetTestsetId =
            payload.targetMode === "existing" ? get(pendingTestsetSelectionAtom) : null
        if (payload.targetMode === "existing" && !targetTestsetId) {
            throw new Error("Select a testset before exporting")
        }

        if (payload.targetMode === "new" && !payload.newTestsetName?.trim()) {
            throw new Error("Enter a testset name before exporting")
        }

        const targetTestsetName =
            payload.targetMode === "existing"
                ? get(pendingTestsetSelectionNameAtom) ||
                  get(defaultTargetTestsetNameAtom) ||
                  "selected testset"
                : payload.newTestsetName?.trim() || "new testset"
        const jobId = createExportJobId()

        set(addToTestsetExportJobAtom, {
            id: jobId,
            status: "preparing",
            total: scenarioIds.length,
            processed: 0,
            targetTestsetId: targetTestsetId ?? undefined,
            targetTestsetName,
        })

        const runExport = async () => {
            let latestRevision: LatestRevisionWithRows | null = null
            let existingColumns = new Set<string>()
            let committedTestsetId = targetTestsetId ?? undefined
            let committedTestsetName = targetTestsetName

            try {
                if (payload.targetMode === "existing" && targetTestsetId) {
                    latestRevision = await fetchLatestRevisionWithRows({
                        projectId,
                        testsetId: targetTestsetId,
                    })
                    existingColumns = extractExistingColumns(latestRevision.data?.testcases)
                }

                const queueKind = get(queueKindAtom)
                const evaluators = get(testsetSyncEvaluatorsAtom)
                const setProcessed = (processed: number) => {
                    set(addToTestsetExportJobAtom, (prev) =>
                        prev.id === jobId ? {...prev, processed} : prev,
                    )
                }

                const rows =
                    queueKind === "traces"
                        ? await prepareTraceExportRows({
                              projectId,
                              scenarioIds,
                              outputColumnName: resolveTraceOutputColumnName({
                                  targetMode: payload.targetMode,
                                  existingColumns,
                              }),
                              queueId,
                              evaluators,
                              requireAnnotationOutputScenarioIds:
                                  resolveCompletedScenarioIdsForAnnotationExport(get, scenarioIds),
                              setProcessed,
                          })
                        : await prepareTestcaseExportRows({
                              projectId,
                              scenarioIds,
                              queueId,
                              evaluators,
                              setProcessed,
                          })

                if (rows.length === 0) {
                    throw new Error("No exportable rows were found for the selected scenarios")
                }

                set(addToTestsetExportJobAtom, (prev) =>
                    prev.id === jobId ? {...prev, status: "committing"} : prev,
                )

                let committedRevisionId: string | undefined

                if (payload.targetMode === "new") {
                    const result = await createTestset({
                        projectId,
                        name: payload.newTestsetName?.trim() || "Annotation queue export",
                        slug: payload.newTestsetSlug,
                        testcases: rows.map((row) => row.data),
                        commitMessage: payload.commitMessage,
                    })
                    committedTestsetId = result?.testset?.id
                    committedRevisionId = result?.revisionId
                    committedTestsetName = result?.testset?.name ?? committedTestsetName
                } else {
                    if (!targetTestsetId || !latestRevision) {
                        throw new Error("The selected testset could not be prepared")
                    }

                    const rowsForCommit = remapRowsToExistingLeafColumns(rows, existingColumns)

                    // Match each annotated row against the testset's LATEST
                    // revision so it replaces its existing row (by testcase id,
                    // falling back to testcase_dedup_id) instead of being
                    // appended. Basing on latest accumulates prior annotations
                    // and respects external edits; the queue's testcases match
                    // by id on a fresh testset and by dedup once an earlier save
                    // has reassigned their ids. The dedup id is read from the
                    // original (pre-remap) data because the remap strips system
                    // fields like `testcase_dedup_id`.
                    const baseRows = await fetchBaseRevisionRows({
                        projectId,
                        revisionId: latestRevision.id,
                    })

                    const commitRows = rowsForCommit.map((row, index) => {
                        const sourceRow = rows[index] as {
                            rowId?: string | null
                            data?: Record<string, unknown> | null
                        }
                        const dedupId = getTestcaseDedupId(sourceRow?.data)
                        // `remapRowsToExistingLeafColumns` strips system fields
                        // (incl. `testcase_dedup_id`). Re-inject it so the
                        // replaced testcase keeps its identity lineage across
                        // revisions — otherwise the testset UI treats the
                        // updated row as a brand-new one instead of an update.
                        const data =
                            dedupId && row.data.testcase_dedup_id === undefined
                                ? {...row.data, testcase_dedup_id: dedupId}
                                : row.data
                        return {
                            rowId: sourceRow?.rowId ?? null,
                            dedupId,
                            data,
                        }
                    })

                    const operations = buildAddToTestsetOperations({
                        rows: commitRows,
                        baseRows,
                    })

                    // Idempotency (AGE-3761): if every annotated row already
                    // matches an identical base row, the delta is empty.
                    // Committing an empty delta still mints a new (identical)
                    // revision on the backend, so skip the commit and keep the
                    // current head — re-saving with nothing changed is a no-op.
                    const hasChanges = Boolean(
                        operations.rows?.replace?.length || operations.rows?.add?.length,
                    )

                    if (hasChanges) {
                        const patchResult = await patchRevision({
                            projectId,
                            testsetId: targetTestsetId,
                            baseRevisionId: latestRevision.id,
                            operations,
                            message: payload.commitMessage,
                        })
                        committedRevisionId = patchResult?.testset_revision?.id
                    } else {
                        committedRevisionId = latestRevision.id
                    }
                }

                if (committedTestsetId) {
                    set(lastUsedTestsetIdAtom, committedTestsetId)
                }
                queryClient.invalidateQueries({queryKey: ["testsets-list"]})
                if (committedTestsetId) {
                    queryClient.invalidateQueries({queryKey: ["testset"], exact: false})
                    queryClient.invalidateQueries({queryKey: ["latest-revision"], exact: false})
                    queryClient.invalidateQueries({queryKey: ["revisions-list"], exact: false})
                }
                set(selectedScenarioIdsAtom, [])
                set(addToTestsetExportJobAtom, {
                    id: jobId,
                    status: "success",
                    total: scenarioIds.length,
                    processed: rows.length,
                    targetTestsetId: committedTestsetId,
                    targetRevisionId: committedRevisionId,
                    targetTestsetName: committedTestsetName,
                })
            } catch (error) {
                set(addToTestsetExportJobAtom, {
                    id: jobId,
                    status: "error",
                    total: scenarioIds.length,
                    processed: get(addToTestsetExportJobAtom).processed,
                    targetTestsetId: committedTestsetId,
                    targetTestsetName: committedTestsetName,
                    error: extractApiErrorMessage(error),
                })
            }
        }

        void runExport()
        return {jobId}
    },
)

// ============================================================================
// SYNC TO TESTSET
// ============================================================================

/**
 * Whether the session can sync annotated data back to the source testset.
 * True when queue kind is "testcases" and at least one scenario is completed.
 */
const canSyncToTestsetAtom = atom<boolean>((get) => {
    const queueKind = get(queueKindAtom)
    if (queueKind !== "testcases") return false
    const ids = get(scenarioIdsAtom)
    const completed = get(completedScenarioIdsAtom)
    const records = get(scenarioRecordsAtom)
    return ids.some((id) => isScenarioCompleted(id, completed, records))
})

const canAddToTestsetAtom = atom<boolean>((get) => {
    const queueKind = get(queueKindAtom)
    const ids = get(scenarioIdsAtom)
    if (ids.length === 0) return false
    if (queueKind === "traces") return true

    const completed = get(completedScenarioIdsAtom)
    const records = get(scenarioRecordsAtom)
    return ids.some((id) => isScenarioCompleted(id, completed, records))
})

async function buildTestsetSyncPreviewForSession(get: Getter) {
    const projectId = getStore().get(projectIdAtom)
    if (!projectId) throw new Error("No project ID")

    const queueId = get(activeQueueIdAtom)
    if (!queueId) throw new Error("No active queue")

    if (get(queueKindAtom) !== "testcases") {
        throw new Error("Testset sync is only available for testcase queues")
    }

    const scenarioIds = get(scenarioIdsAtom)
    const completedIds = get(completedScenarioIdsAtom)
    const records = get(scenarioRecordsAtom)

    const completedScenarios: CompletedScenarioRef[] = scenarioIds
        .filter((id) => isScenarioCompleted(id, completedIds, records))
        .map((scenarioId) => ({
            scenarioId,
            testcaseId: get(scenarioTestcaseRefAtomFamily(scenarioId)).testcaseId,
        }))
        .filter((entry) => entry.testcaseId)

    if (completedScenarios.length === 0) {
        throw new Error("No completed testcase scenarios")
    }

    const testcaseIds = Array.from(new Set(completedScenarios.map((entry) => entry.testcaseId)))
    const testcases = await fetchTestcasesBatch({projectId, testcaseIds})

    const testsetIds = Array.from(
        new Set(
            Array.from(testcases.values())
                .map((testcase) => testcase.testset_id ?? testcase.set_id ?? null)
                .filter(Boolean),
        ),
    ) as string[]

    const [latestRevisionMap, annotationsByTestcaseId] = await Promise.all([
        fetchLatestRevisionsBatch(projectId, testsetIds),
        (async () => {
            const entries = await Promise.all(
                testcaseIds.map(async (testcaseId) => {
                    const response = await queryAnnotations({
                        projectId,
                        annotation: {
                            references: {
                                testcase: {id: testcaseId},
                            },
                        },
                    })
                    return [testcaseId, response.annotations ?? []] as const
                }),
            )
            return new Map(entries)
        })(),
    ])

    const latestRevisionIdsByTestsetId = new Map<string, string>()
    latestRevisionMap.forEach((revision, testsetId) => {
        latestRevisionIdsByTestsetId.set(testsetId, revision.id)
    })

    return buildTestsetSyncPreview({
        queueId,
        completedScenarios,
        testcasesById: testcases,
        annotationsByTestcaseId,
        evaluators: get(testsetSyncEvaluatorsAtom),
        latestRevisionIdsByTestsetId,
    })
}

const syncToTestsetsAtom = atom(null, async (get, set) => {
    const projectId = getStore().get(projectIdAtom)
    if (!projectId) throw new Error("No project ID")

    const queueName = get(queueNameAtom) ?? "Annotation queue results"
    const preview = await buildTestsetSyncPreviewForSession(get)

    if (preview.hasBlockingConflicts) {
        throw new Error("No exportable testcase annotations available for sync")
    }

    const preparedTargets = await Promise.all(
        preview.targets.map(async (target) => {
            const baseRows = await fetchBaseRevisionRows({
                revisionId: target.baseRevisionId,
                projectId,
            })

            return remapTargetRowsToBaseRevision({
                target,
                baseRows,
            })
        }),
    )

    const syncTargets = preparedTargets
        .map((entry) => entry.target)
        .filter((target) => target.rows.length > 0)
    const remapDroppedRows = preparedTargets.reduce((sum, entry) => sum + entry.droppedRowCount, 0)

    const results = await Promise.allSettled(
        syncTargets.map(async (target) => {
            await patchRevision({
                projectId,
                testsetId: target.testsetId,
                baseRevisionId: target.baseRevisionId,
                operations: buildTestsetSyncOperations(target),
                message: `${queueName}: synced annotations`,
            })

            return target
        }),
    )

    const successfulTargets = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
    )
    const failedTargets = results.flatMap((result, index) =>
        result.status === "rejected"
            ? [
                  {
                      testsetId: syncTargets[index]?.testsetId ?? "",
                      rowCount: syncTargets[index]?.rowCount ?? 0,
                      reason: result.reason,
                  },
              ]
            : [],
    )

    if (successfulTargets.length === 0) {
        throw new Error("Failed to sync annotations to testsets")
    }

    return {
        targets: successfulTargets,
        revisionsCreated: successfulTargets.length,
        rowsExported: successfulTargets.reduce((sum, target) => sum + target.rowCount, 0),
        skippedRows: preview.skippedRows + remapDroppedRows,
        rowsFailed: failedTargets.reduce((sum, target) => sum + target.rowCount, 0),
        conflicts: preview.conflicts,
        failedTargets,
    }
})

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
