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
import {fetchTestcase, fetchTestcasesBatch, SYSTEM_FIELDS} from "@agenta/entities/testcase"
import type {Testcase} from "@agenta/entities/testcase"
import {
    createTestset,
    fetchLatestRevisionsBatch,
    fetchLatestRevisionWithTestcases,
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
import {axios, queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {atom, type Getter, type Setter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    buildTestcaseExportRows,
    buildTraceTestsetRows,
    buildTestsetSyncOperations,
    buildTestsetSyncPreview,
    getTestsetSyncEvaluatorColumnKey,
    remapTargetRowsToBaseRevision,
    selectQueueScopedAnnotation,
    type CompletedScenarioRef,
    type TestsetSyncEvaluator,
} from "../testsetSync"
import {getTraceInputDisplayKeys} from "../traceInputDisplay"
import type {
    AnnotationColumnDef,
    ScenarioListColumnDef,
    OpenQueuePayload,
    ApplyRouteStatePayload,
    AnnotationProgress,
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

/** Requested/focused scenario ID from route or navigation state */
const focusedScenarioIdAtom = atom<string | null>(null)

/** Raw scenario records from the queue query */
type ScenarioRecord = Record<string, unknown>
const rawScenarioRecordsAtom = atom<ScenarioRecord[]>((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return []
    return get(simpleQueueMolecule.selectors.scenarios(queueId)) as ScenarioRecord[]
})

/** Stable session-local scenario order to avoid refetch reordering in focus mode. */
const scenarioOrderAtom = atom<string[]>([])

/** Full scenario records — derived from simpleQueueMolecule.selectors.scenarios */
const scenarioRecordsAtom = atom<ScenarioRecord[]>((get) => {
    const records = get(rawScenarioRecordsAtom)
    const orderedIds = get(scenarioOrderAtom)

    if (records.length === 0 || orderedIds.length === 0) return records

    const recordById = new Map<string, ScenarioRecord>()
    for (const record of records) {
        const id = typeof record.id === "string" ? record.id : ""
        if (!id) continue
        recordById.set(id, record)
    }

    const orderedRecords: ScenarioRecord[] = []
    const seen = new Set<string>()

    for (const id of orderedIds) {
        const record = recordById.get(id)
        if (!record) continue
        orderedRecords.push(record)
        seen.add(id)
    }

    for (const record of records) {
        const id = typeof record.id === "string" ? record.id : ""
        if (!id || seen.has(id)) continue
        orderedRecords.push(record)
    }

    return orderedRecords
})

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

/** All scenario IDs — derived from scenario records */
const scenarioIdsAtom = atom<string[]>((get) => {
    const records = get(scenarioRecordsAtom)
    return records.map((s) => (s.id as string) || "").filter(Boolean)
})

/** Scenarios query state — for loading indicators */
const scenariosQueryAtom = atom((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return {isPending: false, isError: false, data: null}
    return get(simpleQueueMolecule.selectors.scenariosQuery(queueId))
})

/** Set of completed scenario IDs */
const completedScenarioIdsAtom = atom<Set<string>>(new Set<string>())

/** Active view in the annotation session ("list" or "annotate") */
const activeSessionViewAtom = atom<SessionView>("annotate")

const hideCompletedInFocusAtom = atom<boolean>(false)
const focusAutoNextAtom = atom<boolean>(true)

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

const syncScenarioOrderAtom = atom(null, (get, set) => {
    const nextIds = get(rawScenarioRecordsAtom)
        .map((record) => (typeof record.id === "string" ? record.id : ""))
        .filter(Boolean)

    if (nextIds.length === 0) {
        if (get(scenarioOrderAtom).length > 0) {
            set(scenarioOrderAtom, [])
        }
        return
    }

    const currentIds = get(scenarioOrderAtom)
    const nextIdSet = new Set(nextIds)
    const mergedIds = currentIds.filter((id) => nextIdSet.has(id))
    const seen = new Set(mergedIds)

    for (const id of nextIds) {
        if (seen.has(id)) continue
        mergedIds.push(id)
        seen.add(id)
    }

    if (
        mergedIds.length === currentIds.length &&
        mergedIds.every((id, index) => currentIds[index] === id)
    ) {
        return
    }

    set(scenarioOrderAtom, mergedIds)
})

function getScenarioStatusValue({
    scenarioId,
    records,
    completed,
}: {
    scenarioId: string
    records: ScenarioRecord[]
    completed: Set<string>
}): string | null {
    if (completed.has(scenarioId)) return "success"
    const record = records.find((r) => r.id === scenarioId)
    return (record?.status as string) ?? null
}

function getNavigableScenarioIds({get, view}: {get: Getter; view?: SessionView}): string[] {
    const ids = get(scenarioIdsAtom)
    const activeView = view ?? get(activeSessionViewAtom)
    if (activeView !== "annotate") return ids

    const hideCompleted = get(hideCompletedInFocusAtom)
    const records = get(scenarioRecordsAtom)
    const completed = get(completedScenarioIdsAtom)

    return ids.filter((scenarioId) => {
        const status = getScenarioStatusValue({scenarioId, records, completed})
        if (hideCompleted && status === "success") {
            return false
        }
        return true
    })
}

const navigableScenarioIdsAtom = atom<string[]>((get) => getNavigableScenarioIds({get}))

// ============================================================================
// DERIVED ATOMS — Queue-level
// ============================================================================

/** Is a session currently active? */
const isActiveAtom = atom<boolean>((get) => get(activeQueueIdAtom) !== null)

/** The current scenario ID */
const currentScenarioIdAtom = atom<string | null>((get) => {
    const allIds = get(scenarioIdsAtom)
    if (allIds.length === 0) return null

    const focusedScenarioId = get(focusedScenarioIdAtom)
    if (focusedScenarioId && allIds.includes(focusedScenarioId)) {
        return focusedScenarioId
    }

    const visibleIds = get(navigableScenarioIdsAtom)
    if (visibleIds.length > 0) return visibleIds[0] ?? null

    return allIds[0] ?? null
})

/** Current scenario index (0-based) */
const currentScenarioIndexAtom = atom<number>((get) => {
    const ids = get(scenarioIdsAtom)
    const currentScenarioId = get(currentScenarioIdAtom)

    if (!currentScenarioId) return 0

    const index = ids.indexOf(currentScenarioId)
    return index >= 0 ? index : 0
})

/** Can navigate to next item? */
const hasNextAtom = atom<boolean>(
    (get) => resolveAdjacentNavigableScenarioId({get, direction: "next"}) !== null,
)

/** Can navigate to previous item? */
const hasPrevAtom = atom<boolean>(
    (get) => resolveAdjacentNavigableScenarioId({get, direction: "prev"}) !== null,
)

/** Progress tracker */
const progressAtom = atom<AnnotationProgress>((get) => {
    const ids = get(scenarioIdsAtom)
    const records = get(scenarioRecordsAtom)
    const locallyCompleted = get(completedScenarioIdsAtom)
    const completedCount = ids.filter((id) => {
        if (locallyCompleted.has(id)) return true
        const record = records.find((r) => r.id === id)
        return record?.status === "success"
    }).length
    return {
        total: ids.length,
        completed: completedCount,
        remaining: ids.length - completedCount,
        currentIndex: get(currentScenarioIndexAtom),
    }
})

/** Is the current scenario already completed? */
const isCurrentCompletedAtom = atom<boolean>((get) => {
    const currentId = get(currentScenarioIdAtom)
    if (!currentId) return false
    if (get(completedScenarioIdsAtom).has(currentId)) return true
    const records = get(scenarioRecordsAtom)
    const record = records.find((r) => r.id === currentId)
    return record?.status === "success"
})

/**
 * Scenario statuses — derived from scenario records with completed overlay.
 * Scenarios marked complete locally (via markCompleted) are shown as "success"
 * even before the server query refreshes.
 */
const scenarioStatusesAtom = atom<Record<string, string | null>>((get) => {
    const records = get(scenarioRecordsAtom)
    const completed = get(completedScenarioIdsAtom)
    const map: Record<string, string | null> = {}
    for (const s of records) {
        const id = s.id as string
        if (!id) continue
        if (completed.has(id)) {
            map[id] = "success"
        } else {
            map[id] = getScenarioStatusValue({scenarioId: id, records, completed})
        }
    }
    return map
})

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
    if (!runId) return []
    return get(evaluationRunMolecule.selectors.evaluatorIds(runId))
})

/**
 * Evaluator revision IDs — derived from evaluation run annotation steps.
 * Uses `step.references.evaluator_revision.id` (specific revision ID).
 * Kept for revision-level resolution when needed.
 */
const evaluatorRevisionIdsAtom = atom<string[]>((get) => {
    const runId = get(activeRunIdAtom)
    if (!runId) return []
    return get(evaluationRunMolecule.selectors.evaluatorRevisionIds(runId))
})

/**
 * Ordered evaluator references from annotation steps.
 * Each entry preserves the queue's pinned evaluator revision while keeping the
 * artifact/variant IDs needed for later annotation submits.
 */
const evaluatorStepRefsAtom = atom<EvaluatorStepRef[]>((get) => {
    const runId = get(activeRunIdAtom)
    if (!runId) return []

    const annotationSteps = get(evaluationRunMolecule.selectors.annotationSteps(runId))

    return annotationSteps
        .map((step) => ({
            workflowId: step.references?.evaluator?.id ?? null,
            variantId: step.references?.evaluator_variant?.id ?? null,
            revisionId: step.references?.evaluator_revision?.id ?? null,
            slug:
                step.references?.evaluator?.slug ??
                step.references?.evaluator_revision?.slug ??
                null,
            stepKey: step.key ?? null,
        }))
        .filter((ref) => Boolean(ref.workflowId || ref.revisionId || ref.slug))
})

/** Evaluator metadata for queue-scoped testcase sync. */
const testsetSyncEvaluatorsAtom = atom<TestsetSyncEvaluator[]>((get) => {
    const runId = get(activeRunIdAtom)
    if (!runId) return []

    const byKey = new Map<string, TestsetSyncEvaluator>()
    const annotationSteps = get(evaluationRunMolecule.selectors.annotationSteps(runId))

    for (const step of annotationSteps) {
        const workflowId = step.references?.evaluator?.id ?? null
        const evaluatorEntity = workflowId ? get(workflowMolecule.selectors.data(workflowId)) : null
        const name = evaluatorEntity?.name?.trim() || null
        const slug =
            step.references?.evaluator?.slug ??
            evaluatorEntity?.slug ??
            step.references?.evaluator_revision?.slug ??
            workflowId

        if (!slug && !workflowId) continue
        const key = workflowId ?? slug
        if (!key) continue

        byKey.set(key, {
            slug: slug ?? key ?? "",
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
    if (!runId) return []
    return get(evaluationRunMolecule.selectors.annotationColumnDefs(runId)) as AnnotationColumnDef[]
})

/**
 * Trace input keys — discovered from the first scenario's trace inputs.
 * Used by the list view to build per-key input columns for trace-based queues.
 *
 * Reactively resolves: scenarioIds[0] → traceRef → traceInputs → Object.keys()
 */
const traceInputKeysAtom = atom<string[]>((get) => {
    const kind = get(queueKindAtom)
    if (kind !== "traces") return []

    const ids = get(scenarioIdsAtom)
    if (ids.length === 0) return []

    // Resolve the first scenario's trace ID
    const firstScenarioId = ids[0]
    const runId = get(activeRunIdAtom)
    if (!runId || !firstScenarioId) return []

    const traceRef = get(
        evaluationRunMolecule.selectors.scenarioTraceRef({runId, scenarioId: firstScenarioId}),
    )
    const traceId = traceRef?.traceId
    if (!traceId) return []

    // Read the trace inputs and extract keys
    const inputs = get(traceInputsAtomFamily(traceId))
    if (!inputs) return []

    return getTraceInputDisplayKeys(inputs)
})

/**
 * Testcase data — fetched by testcaseId via atomWithQuery.
 * Used by list view cell renderers and testcase key discovery.
 */
const testcaseDataAtomFamily = atomFamily((testcaseId: string) =>
    atomWithQuery<Testcase | null>((get) => {
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["annotation-testcase", projectId, testcaseId],
            queryFn: async () => {
                if (!projectId || !testcaseId) return null
                return fetchTestcase({projectId, testcaseId})
            },
            enabled: !!projectId && !!testcaseId,
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/**
 * All testcase IDs referenced by the current queue scenarios.
 * Used for batch testcase fetch + unioned column discovery.
 */
const scenarioTestcaseIdsAtom = atom<string[]>((get) => {
    const kind = get(queueKindAtom)
    if (kind !== "testcases") return []

    const scenarioIds = get(scenarioIdsAtom)
    const seen = new Set<string>()

    for (const scenarioId of scenarioIds) {
        const testcaseId = get(scenarioTestcaseRefAtomFamily(scenarioId)).testcaseId
        if (testcaseId) {
            seen.add(testcaseId)
        }
    }

    return Array.from(seen)
})

/**
 * Batch testcase data for all testcase scenarios in the current queue.
 * Used for unioned testcase column discovery across the whole queue.
 */
const scenarioTestcasesQueryAtom = atomWithQuery<Testcase[]>((get) => {
    const queueId = get(activeQueueIdAtom)
    const testcaseIds = get(scenarioTestcaseIdsAtom)

    return {
        queryKey: ["annotation-testcases-batch", queueId ?? "none", testcaseIds],
        queryFn: async () => {
            const projectId = getDefaultStore().get(projectIdAtom)
            if (testcaseIds.length === 0) return []
            if (!projectId) {
                throw new Error("projectId not yet available")
            }

            const testcaseMap = await fetchTestcasesBatch({projectId, testcaseIds})
            return testcaseIds
                .map((testcaseId) => testcaseMap.get(testcaseId) ?? null)
                .filter((testcase): testcase is Testcase => testcase !== null)
        },
        enabled: testcaseIds.length > 0,
        retry: (failureCount: number, error: Error) => {
            if (error?.message === "projectId not yet available" && failureCount < 5) {
                return true
            }
            return false
        },
        retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Testcase input keys — discovered from all testcase data in the queue.
 * Used by the list view to build per-key columns for testcase-based queues.
 *
 * Reactively resolves: scenarioIds[] → testcaseIds[] → batched testcase fetch → union(Object.keys(data))
 */
const testcaseInputKeysAtom = atom<string[]>((get) => {
    const kind = get(queueKindAtom)
    if (kind !== "testcases") return []

    const query = get(scenarioTestcasesQueryAtom)
    const testcases = query.data ?? []
    if (testcases.length === 0) return []

    const keys = new Set<string>()
    for (const testcase of testcases) {
        for (const key of Object.keys(testcase.data ?? {})) {
            if (!TESTCASE_SYSTEM_KEYS.has(key)) {
                keys.add(key)
            }
        }
    }

    return Array.from(keys)
})

// ============================================================================
// COLUMN DISCOVERY HELPERS (for testcase-based queues)
// ============================================================================

/** System keys to exclude from testcase data columns (internal fields not for display) */
const TESTCASE_SYSTEM_KEYS = new Set(["testcase_dedup_id", "__dedup_id__"])

/** Keys to exclude from display in testcase columns */
const EXCLUDE_KEYS = new Set([
    "id",
    "created_at",
    "updated_at",
    "created_by_id",
    "updated_by_id",
    "run_id",
    "version",
    "__isSkeleton",
    "key",
    "trace_id",
    "span_id",
    "status",
    "interval",
    "timestamp",
])

/** Keys that represent outputs */
export const OUTPUT_KEYS = new Set(["output", "outputs", "result", "response", "completion"])

/** Keys that represent expected/reference outputs */
const EXPECTED_OUTPUT_KEYS = new Set([
    "expected_output",
    "expected",
    "reference",
    "reference_output",
    "ground_truth",
    "golden",
    "target",
    "correct_answer",
])

/** Keys that represent metadata (tags/meta) */
const META_KEYS = new Set(["tags", "meta"])

type TestcaseColumnGroup = "input" | "output" | "expected"

function getAnnotationDisplayTitle(get: Getter, def: AnnotationColumnDef): string {
    const evaluator = def.evaluatorId ? get(workflowMolecule.selectors.data(def.evaluatorId)) : null
    return (
        evaluator?.name?.trim() ||
        evaluator?.slug?.trim() ||
        def.evaluatorSlug?.trim() ||
        def.columnName?.trim() ||
        def.stepKey?.trim() ||
        ""
    )
}

function getAnnotationGroupKey(get: Getter, def: AnnotationColumnDef): string {
    return (
        def.evaluatorId?.trim() ||
        def.evaluatorSlug?.trim() ||
        getAnnotationDisplayTitle(get, def).trim().toLowerCase() ||
        def.stepKey
    )
}

function stripOutputPathPrefix(path: string): string {
    for (const prefix of ["attributes.ag.data.outputs.", "data.outputs.", "outputs."]) {
        if (path.startsWith(prefix)) {
            return path.slice(prefix.length)
        }
    }
    return path
}

function getAnnotationChildTitle(def: AnnotationColumnDef): string {
    const path = def.path?.trim()
    if (path) {
        const stripped = stripOutputPathPrefix(path)
        if (stripped && stripped !== path) return stripped

        const leaf = stripped.split(".").filter(Boolean).at(-1)
        if (leaf && leaf !== "outputs") return leaf
    }

    return def.columnName?.trim() || def.stepKey
}

/**
 * Analyze scenario records to discover dynamic testcase columns.
 * Returns column definitions grouped by input/output/expected.
 */
function discoverTestcaseColumns(
    scenarios: ScenarioRecord[],
): {key: string; title: string; group: TestcaseColumnGroup}[] {
    const seen = new Map<string, TestcaseColumnGroup>()

    for (const scenario of scenarios) {
        for (const key of Object.keys(scenario)) {
            if (EXCLUDE_KEYS.has(key) || META_KEYS.has(key) || seen.has(key)) continue

            let group: TestcaseColumnGroup = "input"
            if (OUTPUT_KEYS.has(key)) group = "output"
            else if (EXPECTED_OUTPUT_KEYS.has(key)) group = "expected"

            seen.set(key, group)
        }

        // Also inspect `meta` for nested data fields
        const meta = scenario.meta
        if (meta && typeof meta === "object") {
            for (const key of Object.keys(meta as Record<string, unknown>)) {
                const prefixed = `meta.${key}`
                if (seen.has(prefixed)) continue
                if (["trace_id", "span_id"].includes(key)) continue

                let group: TestcaseColumnGroup = "input"
                if (OUTPUT_KEYS.has(key)) group = "output"
                else if (EXPECTED_OUTPUT_KEYS.has(key)) group = "expected"

                seen.set(prefixed, group)
            }
        }
    }

    return Array.from(seen.entries()).map(([key, group]) => ({
        key,
        title: key.startsWith("meta.") ? key.slice(5) : key,
        group,
    }))
}

// ============================================================================
// DERIVED ATOM — Full list column definitions
// ============================================================================

/**
 * Complete ordered list of column definitions for the scenario list table.
 * Combines: index + data columns (trace or testcase) + annotation columns + status + actions.
 *
 * The presentation layer maps each def to a renderer based on `columnType`.
 */
const listColumnDefsAtom = atom<ScenarioListColumnDef[]>((get) => {
    const kind = get(queueKindAtom)
    const inputKeys = get(traceInputKeysAtom)
    const annotationDefs = get(annotationColumnDefsAtom)
    const records = get(scenarioRecordsAtom)
    // Note: if two annotation defs resolve to the same lowercase title, the later one wins.
    // This is acceptable since duplicate evaluator names within a single run are uncommon.
    const annotationColumnsByTitle = new Map(
        annotationDefs
            .map((def) => {
                const title = getAnnotationDisplayTitle(get, def)
                return title ? ([title.trim().toLowerCase(), def] as const) : null
            })
            .filter((entry): entry is readonly [string, AnnotationColumnDef] => entry !== null),
    )
    const mergedFallbackKeys = new Map<string, string>()

    // Leading: index column
    const leading: ScenarioListColumnDef[] = [
        {columnType: "index", key: "__index", title: "#", width: 64, fixed: "left"},
    ]

    // Data columns depend on queue kind
    let dataColumns: ScenarioListColumnDef[] = []

    if (kind === "traces") {
        // Trace-based: name + per-key inputs (or fallback) + outputs
        const traceName: ScenarioListColumnDef = {
            columnType: "trace-name",
            key: "__trace_name",
            title: "Trace",
            width: 180,
        }

        const traceInputGroup: ScenarioListColumnDef = {
            columnType: "trace-input-group",
            key: "__trace_inputs",
            title: "Inputs",
            width: inputKeys.length > 1 ? 250 * inputKeys.length : 300,
            inputKeys,
        }

        const traceOutput: ScenarioListColumnDef = {
            columnType: "trace-output",
            key: "__trace_outputs",
            title: "Outputs",
            width: 300,
        }

        dataColumns = [traceName, traceInputGroup, traceOutput]
    } else {
        // Testcase-based: discover columns from fetched testcase data keys
        const testcaseKeys = get(testcaseInputKeysAtom)

        if (testcaseKeys.length > 0) {
            // Categorize keys using the same sets used for scenario records
            const inputCols: string[] = []
            const outputCols: string[] = []
            const expectedCols: string[] = []

            for (const key of testcaseKeys) {
                const normalizedKey = key.trim().toLowerCase()
                if (annotationColumnsByTitle.has(normalizedKey)) {
                    mergedFallbackKeys.set(normalizedKey, key)
                    continue
                }
                if (OUTPUT_KEYS.has(key)) outputCols.push(key)
                else if (EXPECTED_OUTPUT_KEYS.has(key)) expectedCols.push(key)
                else inputCols.push(key)
            }

            dataColumns = [
                ...inputCols.map(
                    (key): ScenarioListColumnDef => ({
                        columnType: "testcase-input",
                        key,
                        title: key,
                        width: 200,
                        dataKey: key,
                    }),
                ),
                ...outputCols.map(
                    (key): ScenarioListColumnDef => ({
                        columnType: "testcase-output",
                        key,
                        title: key,
                        width: 200,
                        dataKey: key,
                    }),
                ),
                ...expectedCols.map(
                    (key): ScenarioListColumnDef => ({
                        columnType: "testcase-expected",
                        key,
                        title: key,
                        width: 200,
                        dataKey: key,
                    }),
                ),
            ]
        } else {
            // Fallback: discover from scenario records (works if data is inline)
            const discovered = discoverTestcaseColumns(records).filter((col) => {
                const normalizedTitle = col.title.trim().toLowerCase()
                if (annotationColumnsByTitle.has(normalizedTitle)) {
                    mergedFallbackKeys.set(normalizedTitle, col.key)
                    return false
                }
                return true
            })
            const inputColsF = discovered.filter((c) => c.group === "input")
            const outputColsF = discovered.filter((c) => c.group === "output")
            const expectedColsF = discovered.filter((c) => c.group === "expected")

            dataColumns = [
                ...inputColsF.map(
                    (col): ScenarioListColumnDef => ({
                        columnType: "testcase-input",
                        key: col.key,
                        title: col.title,
                        width: 200,
                        dataKey: col.key,
                    }),
                ),
                ...outputColsF.map(
                    (col): ScenarioListColumnDef => ({
                        columnType: "testcase-output",
                        key: col.key,
                        title: col.title,
                        width: 200,
                        dataKey: col.key,
                    }),
                ),
                ...expectedColsF.map(
                    (col): ScenarioListColumnDef => ({
                        columnType: "testcase-expected",
                        key: col.key,
                        title: col.title,
                        width: 200,
                        dataKey: col.key,
                    }),
                ),
            ]
        }
    }

    // Annotation columns — group mapping columns under their evaluator parent.
    const annotationGroups = new Map<
        string,
        {title: string; defs: AnnotationColumnDef[]; fallbackDataKey: string | null}
    >()
    for (const def of annotationDefs) {
        const displayTitle = getAnnotationDisplayTitle(get, def)
        const groupKey = getAnnotationGroupKey(get, def)
        const existing = annotationGroups.get(groupKey)

        if (existing) {
            existing.defs.push(def)
            continue
        }

        annotationGroups.set(groupKey, {
            title: displayTitle || def.columnName || def.evaluatorSlug || def.stepKey,
            defs: [def],
            fallbackDataKey: mergedFallbackKeys.get(displayTitle.trim().toLowerCase()) ?? null,
        })
    }

    const annotationColumns: ScenarioListColumnDef[] = Array.from(annotationGroups.entries()).map(
        ([groupKey, group]) => {
            const childTitleCounts = new Map<string, number>()
            const outputColumns = group.defs.map((def) => {
                const title = getAnnotationChildTitle(def)
                const count = childTitleCounts.get(title) ?? 0
                childTitleCounts.set(title, count + 1)

                return {
                    key: `__annot_${groupKey}_${title}_${count}`,
                    title,
                    annotationDef: def,
                }
            })

            return {
                columnType: "annotation" as const,
                key: `__annot_${groupKey}`,
                title: group.title,
                width: 150 * Math.max(outputColumns.length, 1),
                annotationDef: group.defs[0],
                outputKeys: outputColumns.map((column) => column.title),
                outputColumns,
                fallbackDataKey: group.fallbackDataKey,
            }
        },
    )

    // Trailing: review status + actions
    const trailing: ScenarioListColumnDef[] = [
        {columnType: "status", key: "__status", title: "Review Status", width: 120},
        {columnType: "actions", key: "__actions", title: "", width: 48},
    ]

    return [...leading, ...dataColumns, ...annotationColumns, ...trailing]
})

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
        if (!runId || !scenarioId) return null
        return get(evaluationRunMolecule.selectors.scenarioSteps({runId, scenarioId}))
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
        if (!runId || !scenarioId) return directRef

        const stepRef = get(evaluationRunMolecule.selectors.scenarioTraceRef({runId, scenarioId}))
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
        if (!runId || !scenarioId) return directRef

        const stepRef = get(
            evaluationRunMolecule.selectors.scenarioTestcaseRef({runId, scenarioId}),
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
        if (!runId || !scenarioId) return []

        // Get annotation step info from the run definition
        const annotationSteps = get(evaluationRunMolecule.selectors.annotationSteps(runId))
        if (annotationSteps.length === 0) return []

        // Get scenario step results (evaluation results)
        const stepsQuery = get(evaluationRunMolecule.selectors.scenarioSteps({runId, scenarioId}))
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
        atomWithQuery(() => ({
            queryKey: ["scenarioAnnotationsByTestcase", scenarioId, testcaseId],
            queryFn: async (): Promise<Annotation[]> => {
                const projectId = getStore().get(projectIdAtom)
                if (!projectId || !testcaseId) return []
                const response = await queryAnnotations({
                    projectId,
                    annotation: {
                        references: {
                            testcase: {id: testcaseId},
                        },
                    },
                })
                return response.annotations ?? []
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
        })),
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
 * Metrics data for a single scenario, fetched from
 * `POST /evaluations/metrics/query`.
 *
 * `raw`  — nested metric data as returned by the API (merged across entries).
 * `flat` — flattened key→value map for easy column lookup.
 */
export interface ScenarioMetricData {
    raw: Record<string, unknown>
    flat: Record<string, unknown>
    /** Full metric stats objects keyed the same as `flat`, for distribution rendering */
    stats: Record<string, Record<string, unknown>>
}

/** Deep-merge two plain objects (arrays and primitives are overwritten). */
function mergeDeep(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
): Record<string, unknown> {
    const output: Record<string, unknown> = {...target}
    for (const [key, value] of Object.entries(source ?? {})) {
        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            typeof output[key] === "object" &&
            output[key] !== null &&
            !Array.isArray(output[key])
        ) {
            output[key] = mergeDeep(
                output[key] as Record<string, unknown>,
                value as Record<string, unknown>,
            )
        } else {
            output[key] = value
        }
    }
    return output
}

/**
 * Check if an object is a metric data shape (has a `type` field like "binary",
 * "categorical/multiple", "string", "continuous").
 * These are leaf metric objects that should be resolved to a display value.
 */
function isMetricDataObject(v: Record<string, unknown>): boolean {
    return (
        typeof v.type === "string" &&
        ["binary", "categorical/multiple", "categorical/single", "string", "continuous"].includes(
            v.type as string,
        )
    )
}

/**
 * Extract a display value from a metric data object.
 * - binary: returns the boolean value of the dominant frequency entry
 * - categorical: returns the array of unique values
 * - continuous: returns the mean or first freq value
 * - string: returns the count or freq values
 */
function extractMetricDisplayValue(v: Record<string, unknown>): unknown {
    const type = v.type as string
    const freq = Array.isArray(v.freq) ? v.freq : []

    if (type === "binary") {
        // Find the freq entry with count > 0
        const active = freq.find(
            (f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0,
        )
        return active?.value ?? null
    }
    if (type === "categorical/multiple" || type === "categorical/single") {
        // Return array of values with count > 0
        const activeValues = freq
            .filter((f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0)
            .map((f: Record<string, unknown>) => f.value)
        return activeValues.length > 0 ? activeValues : (v.uniq ?? null)
    }
    if (type === "continuous") {
        if (typeof v.mean === "number") return v.mean
        const active = freq.find(
            (f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0,
        )
        return active?.value ?? null
    }
    if (type === "string") {
        if (freq.length > 0) {
            const active = freq.find(
                (f: Record<string, unknown>) => typeof f.count === "number" && f.count > 0,
            )
            return active?.value ?? null
        }
        return v.count ?? null
    }
    return null
}

/** Flatten nested metric data to dot-notation keys for easy lookup. */
function flattenMetrics(raw: Record<string, unknown>): {
    flat: Record<string, unknown>
    stats: Record<string, Record<string, unknown>>
} {
    const flat: Record<string, unknown> = {}
    const stats: Record<string, Record<string, unknown>> = {}

    const storeKeys = (
        fullKey: string,
        prefix: string,
        key: string,
        displayValue: unknown,
        statsObj: Record<string, unknown> | null,
    ) => {
        flat[fullKey] = displayValue
        if (statsObj) stats[fullKey] = statsObj

        // Stripped prefix: "query-direct.slug.attributes.ag.data.outputs.isAwesome" → "isAwesome"
        const outputMatch = fullKey.match(
            /(?:attributes\.ag\.data\.outputs\.|data\.outputs\.|outputs\.)(.+)$/,
        )
        if (outputMatch) {
            const outputKey = outputMatch[1]
            if (flat[outputKey] === undefined) {
                flat[outputKey] = displayValue
                if (statsObj) stats[outputKey] = statsObj
            }
        }
        if (prefix && flat[key] === undefined) {
            flat[key] = displayValue
            if (statsObj) stats[key] = statsObj
        }
    }

    const walk = (obj: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key

            if (value && typeof value === "object" && !Array.isArray(value)) {
                const v = value as Record<string, unknown>

                // Check if it's a metric data shape — extract display value + keep stats
                if (isMetricDataObject(v)) {
                    const displayValue = extractMetricDisplayValue(v)
                    storeKeys(fullKey, prefix, key, displayValue, v)
                    continue
                }

                // Check if it's a stats object with a scalar value
                if (typeof v.mean === "number") {
                    flat[fullKey] = v.mean
                    stats[fullKey] = v
                } else if (typeof v.sum === "number") {
                    flat[fullKey] = v.sum
                    stats[fullKey] = v
                }
                // Recurse into nested objects
                walk(v, fullKey)
            } else {
                flat[fullKey] = value
            }

            // Also store unprefixed key for easier lookup
            if (prefix && flat[key] === undefined) {
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    const v = value as Record<string, unknown>
                    if (typeof v.mean === "number") {
                        flat[key] = v.mean
                        stats[key] = v
                    } else if (typeof v.sum === "number") {
                        flat[key] = v.sum
                        stats[key] = v
                    }
                } else {
                    flat[key] = value
                }
            }
        }
    }

    walk(raw, "")
    return {flat, stats}
}

/**
 * Per-scenario metrics query — fetches from `POST /evaluations/metrics/query`.
 *
 * Annotation queues ARE evaluation runs, so each scenario has metrics
 * produced by evaluator steps. This is the same endpoint used by
 * EvalRunDetails but scoped to the annotation session's run + scenario.
 */
const scenarioMetricsQueryAtomFamily = atomFamily((scenarioId: string) =>
    atomWithQuery<ScenarioMetricData | null>((get) => {
        const runId = get(activeRunIdAtom)
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["annotation-session", "scenario-metrics", projectId, runId, scenarioId],
            queryFn: async (): Promise<ScenarioMetricData | null> => {
                if (!projectId || !runId || !scenarioId) return null

                const response = await axios.post(
                    `/evaluations/metrics/query`,
                    {
                        metrics: {
                            scenario_ids: [scenarioId],
                        },
                    },
                    {params: {project_id: projectId}},
                )

                const rawMetrics = Array.isArray(response.data?.metrics)
                    ? response.data.metrics
                    : []

                if (rawMetrics.length === 0) return null

                // Merge all metric entries for this scenario
                let merged: Record<string, unknown> = {}
                for (const entry of rawMetrics) {
                    const data = entry.data ?? entry
                    if (data && typeof data === "object") {
                        merged = mergeDeep(merged, data as Record<string, unknown>)
                    }
                }

                const {flat, stats} = flattenMetrics(merged)
                return {raw: merged, flat, stats}
            },
            enabled: Boolean(projectId && runId && scenarioId),
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

/**
 * Resolved metrics data for a scenario.
 * Returns the flat + raw metric data (or null if not loaded).
 */
const scenarioMetricsAtomFamily = atomFamily((scenarioId: string) =>
    atom<ScenarioMetricData | null>((get) => {
        if (!scenarioId) return null
        const query = get(scenarioMetricsQueryAtomFamily(scenarioId))
        return query.data ?? null
    }),
)

/**
 * Resolve a metric value for a specific scenario + evaluator step.
 *
 * Looks up the value from the flattened metrics map using multiple
 * candidate keys (stepKey-prefixed, evaluatorSlug-prefixed, and plain path).
 */
function resolveMetricValue(
    metrics: ScenarioMetricData | null,
    path: string | null | undefined,
    stepKey: string | null | undefined,
    evaluatorSlug: string | null | undefined,
): unknown {
    if (!metrics || !path) return undefined

    const flat = metrics.flat
    if (!flat || Object.keys(flat).length === 0) return undefined

    // Strip common prefixes from path
    let cleanPath = path
    for (const prefix of ["attributes.ag.data.outputs.", "data.outputs.", "outputs."]) {
        if (cleanPath.startsWith(prefix)) {
            cleanPath = cleanPath.slice(prefix.length)
            break
        }
    }

    // Build candidate keys in priority order
    const candidates: string[] = []

    // Step-prefixed candidates (most specific)
    if (stepKey) {
        candidates.push(`${stepKey}.${cleanPath}`)
        candidates.push(`${stepKey}.${path}`)
    }

    // Evaluator-slug-prefixed candidates
    if (evaluatorSlug) {
        candidates.push(`${evaluatorSlug}.${cleanPath}`)
        candidates.push(`${evaluatorSlug}.${path}`)
    }

    // Plain path candidates
    candidates.push(cleanPath)
    candidates.push(path)

    // Direct lookup
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(flat, key)) {
            return flat[key]
        }
    }

    // Suffix match — find any key ending with the path
    for (const suffix of [`.${cleanPath}`, `.${path}`]) {
        const matchKey = Object.keys(flat).find((k) => k.endsWith(suffix))
        if (matchKey !== undefined) {
            return flat[matchKey]
        }
    }

    return undefined
}

/**
 * Resolve the full stats object for a metric (for distribution bar rendering).
 * Uses the same candidate-key logic as resolveMetricValue but reads from `stats` map.
 */
function resolveMetricStats(
    metrics: ScenarioMetricData | null,
    path: string | null | undefined,
    stepKey: string | null | undefined,
    evaluatorSlug: string | null | undefined,
): Record<string, unknown> | undefined {
    if (!metrics || !path) return undefined

    const statsMap = metrics.stats
    if (!statsMap || Object.keys(statsMap).length === 0) return undefined

    let cleanPath = path
    for (const prefix of ["attributes.ag.data.outputs.", "data.outputs.", "outputs."]) {
        if (cleanPath.startsWith(prefix)) {
            cleanPath = cleanPath.slice(prefix.length)
            break
        }
    }

    const candidates: string[] = []
    if (stepKey) {
        candidates.push(`${stepKey}.${cleanPath}`)
        candidates.push(`${stepKey}.${path}`)
    }
    if (evaluatorSlug) {
        candidates.push(`${evaluatorSlug}.${cleanPath}`)
        candidates.push(`${evaluatorSlug}.${path}`)
    }
    candidates.push(cleanPath)
    candidates.push(path)

    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(statsMap, key)) {
            return statsMap[key]
        }
    }

    for (const suffix of [`.${cleanPath}`, `.${path}`]) {
        const matchKey = Object.keys(statsMap).find((k) => k.endsWith(suffix))
        if (matchKey !== undefined) {
            return statsMap[matchKey]
        }
    }

    return undefined
}

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
            queryClient.setQueryData(["scenarioSteps", runId, scenarioId], freshSteps)
        } catch {
            freshSteps = null
        }
    }

    if (runId && !freshSteps) {
        const stepsQuery = store.get(
            evaluationRunMolecule.selectors.scenarioSteps({runId, scenarioId}),
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
    const annotationSteps = runId
        ? store.get(evaluationRunMolecule.selectors.annotationSteps(runId))
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
                const annotations = mergeAnnotationsByTraceSpan(
                    response.annotations ?? [],
                    fallbackAnnotations,
                )
                queryClient.setQueryData(
                    ["scenarioAnnotationsByTestcase", scenarioId, testcaseRef.testcaseId],
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
const openQueueAtom = atom(null, (_get, set, payload: OpenQueuePayload) => {
    const {queueId, queueType, initialView, initialScenarioId} = payload

    // Register type hint for the queue controller
    registerQueueTypeHint(queueId, queueType)

    // Set session state
    // activeRunIdAtom is derived from simpleQueueMolecule — no manual set needed
    set(activeQueueIdAtom, queueId)
    set(activeQueueTypeAtom, queueType)
    set(focusedScenarioIdAtom, initialScenarioId ?? null)
    set(completedScenarioIdsAtom, new Set())
    set(scenarioOrderAtom, [])
    set(activeSessionViewAtom, initialView ?? "annotate")
    set(hideCompletedInFocusAtom, false)
    set(focusAutoNextAtom, true)

    // scenarioIdsAtom and scenarioRecordsAtom are now derived from
    // simpleQueueMolecule.selectors.scenarios(queueId) — no manual set needed.

    // Notify callback
    _onQueueOpened?.(queueId, queueType)
})

/**
 * Navigate to next scenario.
 */
const navigateNextAtom = atom(null, (get, set) => {
    const scenarioId = resolveAdjacentNavigableScenarioId({
        get,
        direction: "next",
    })
    if (scenarioId) {
        setFocusedScenarioId({get, set, scenarioId, notify: true})
    }
})

/**
 * Navigate to previous scenario.
 */
const navigatePrevAtom = atom(null, (get, set) => {
    const scenarioId = resolveAdjacentNavigableScenarioId({
        get,
        direction: "prev",
    })
    if (scenarioId) {
        setFocusedScenarioId({get, set, scenarioId, notify: true})
    }
})

/**
 * Navigate to a specific scenario by index.
 */
const navigateToIndexAtom = atom(null, (get, set, index: number) => {
    const ids = get(navigableScenarioIdsAtom)
    if (index >= 0 && index < ids.length) {
        setFocusedScenarioId({get, set, scenarioId: ids[index], notify: true})
    }
})

/**
 * Mark a scenario as completed.
 */
const markCompletedAtom = atom(null, (get, set, scenarioId: string) => {
    const current = get(completedScenarioIdsAtom)
    const next = new Set(current)
    next.add(scenarioId)
    set(completedScenarioIdsAtom, next)
})

/**
 * Check if a scenario is completed (locally or server-side).
 */
function isScenarioCompleted(
    id: string,
    completed: Set<string>,
    records: Record<string, unknown>[],
): boolean {
    if (completed.has(id)) return true
    const record = records.find((r) => r.id === id)
    return record?.status === "success"
}

function resolveFallbackScenarioId({
    ids,
    records,
    completed,
    view,
}: {
    ids: string[]
    records: Record<string, unknown>[]
    completed: Set<string>
    view: SessionView
}): string | null {
    if (ids.length === 0) return null

    if (view === "annotate") {
        return ids.find((id) => !isScenarioCompleted(id, completed, records)) ?? ids[0] ?? null
    }

    return ids[0] ?? null
}

function resolveAdjacentNavigableScenarioId({
    get,
    direction,
}: {
    get: Getter
    direction: "next" | "prev"
}): string | null {
    const ids = get(navigableScenarioIdsAtom)
    if (ids.length === 0) return null

    const currentId = get(focusedScenarioIdAtom) ?? get(currentScenarioIdAtom)
    if (!currentId) {
        return direction === "next" ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null)
    }

    const visibleIndex = ids.indexOf(currentId)
    if (visibleIndex >= 0) {
        return direction === "next"
            ? (ids[visibleIndex + 1] ?? null)
            : (ids[visibleIndex - 1] ?? null)
    }

    const allIds = get(scenarioIdsAtom)
    const currentIndex = allIds.indexOf(currentId)
    if (currentIndex < 0) {
        return direction === "next" ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null)
    }

    const matches = ids.filter((id) => {
        const idIndex = allIds.indexOf(id)
        return direction === "next" ? idIndex > currentIndex : idIndex < currentIndex
    })

    return direction === "next" ? (matches[0] ?? null) : (matches[matches.length - 1] ?? null)
}

function setFocusedScenarioId({
    get,
    set,
    scenarioId,
    notify = false,
}: {
    get: Getter
    set: Setter
    scenarioId: string | null
    notify?: boolean
}) {
    const previousScenarioId = get(currentScenarioIdAtom)
    set(focusedScenarioIdAtom, scenarioId)

    if (!notify || !scenarioId || scenarioId === previousScenarioId) return

    const ids = get(navigableScenarioIdsAtom)
    const index = ids.indexOf(scenarioId)

    if (index >= 0) {
        _onNavigate?.(scenarioId, index)
    }
}

/**
 * Mark current scenario as completed and advance to the next pending scenario.
 */
const completeAndAdvanceAtom = atom(null, (get, set) => {
    const currentId = get(currentScenarioIdAtom)
    if (currentId) {
        set(markCompletedAtom, currentId)
        _onAnnotationSubmitted?.(currentId)
    }

    const nextScenarioId = resolveAdjacentNavigableScenarioId({
        get,
        direction: "next",
    })
    if (nextScenarioId) {
        setFocusedScenarioId({get, set, scenarioId: nextScenarioId, notify: true})
    }
})

/**
 * Set the active session view ("list" or "annotate").
 * When switching to "annotate", keep the current focused scenario if valid;
 * otherwise focus the first pending scenario.
 */
const setActiveViewAtom = atom(null, (get, set, view: SessionView) => {
    set(activeSessionViewAtom, view)

    if (view !== "annotate") return

    const focusedScenarioId = get(focusedScenarioIdAtom)
    const allIds = get(scenarioIdsAtom)
    if (focusedScenarioId && allIds.includes(focusedScenarioId)) {
        setFocusedScenarioId({get, set, scenarioId: focusedScenarioId})
        return
    }

    const currentScenarioId = get(currentScenarioIdAtom)
    if (currentScenarioId && allIds.includes(currentScenarioId)) {
        set(focusedScenarioIdAtom, currentScenarioId)
        return
    }

    const ids = getNavigableScenarioIds({get, view})
    const records = get(scenarioRecordsAtom) as Record<string, unknown>[]
    const completed = get(completedScenarioIdsAtom)
    const fallbackScenarioId = resolveFallbackScenarioId({ids, records, completed, view})

    if (fallbackScenarioId) {
        setFocusedScenarioId({get, set, scenarioId: fallbackScenarioId})
    }
})

const setHideCompletedInFocusAtom = atom(null, (get, set, hideCompleted: boolean) => {
    const previousScenarioId = get(currentScenarioIdAtom)
    set(hideCompletedInFocusAtom, hideCompleted)

    const ids = get(navigableScenarioIdsAtom)
    if (previousScenarioId && ids.includes(previousScenarioId)) {
        setFocusedScenarioId({get, set, scenarioId: previousScenarioId, notify: true})
        return
    }

    if (ids.length === 0) {
        setFocusedScenarioId({get, set, scenarioId: null, notify: true})
        return
    }

    const records = get(scenarioRecordsAtom) as Record<string, unknown>[]
    const completed = get(completedScenarioIdsAtom)
    const fallbackScenarioId = resolveFallbackScenarioId({
        ids,
        records,
        completed,
        view: "annotate",
    })

    setFocusedScenarioId({get, set, scenarioId: fallbackScenarioId, notify: true})
})

const setFocusAutoNextAtom = atom(null, (_get, set, autoNext: boolean) => {
    set(focusAutoNextAtom, autoNext)
})

/**
 * Apply route state from URL parameters.
 */
const applyRouteStateAtom = atom(null, (get, set, payload: ApplyRouteStatePayload) => {
    const nextView = payload.view ?? get(activeSessionViewAtom)
    set(activeSessionViewAtom, nextView)

    const allIds = get(scenarioIdsAtom)
    const ids = getNavigableScenarioIds({get, view: nextView})
    const requestedScenarioId =
        payload.scenarioId === undefined ? get(focusedScenarioIdAtom) : payload.scenarioId

    if (requestedScenarioId && allIds.includes(requestedScenarioId)) {
        setFocusedScenarioId({get, set, scenarioId: requestedScenarioId, notify: true})
        return
    }

    if (allIds.length === 0) {
        set(focusedScenarioIdAtom, null)
        return
    }

    const records = get(scenarioRecordsAtom) as Record<string, unknown>[]
    const completed = get(completedScenarioIdsAtom)
    const fallbackScenarioId = resolveFallbackScenarioId({
        ids,
        records,
        completed,
        view: nextView,
    })

    setFocusedScenarioId({get, set, scenarioId: fallbackScenarioId, notify: true})
})

/**
 * Close the annotation session.
 * Clears all session state and type hints.
 */
const closeSessionAtom = atom(null, (get, set) => {
    const queueId = get(activeQueueIdAtom)

    // Clear type hint
    if (queueId) {
        clearQueueTypeHint(queueId)
    }

    // Reset all state
    // Derived atoms (activeRunIdAtom, scenarioIdsAtom, scenarioRecordsAtom)
    // clear automatically when activeQueueIdAtom becomes null.
    set(activeQueueIdAtom, null)
    set(activeQueueTypeAtom, null)
    set(focusedScenarioIdAtom, null)
    set(completedScenarioIdsAtom, new Set())
    set(scenarioOrderAtom, [])
    set(activeSessionViewAtom, "annotate")
    set(hideCompletedInFocusAtom, false)
    set(focusAutoNextAtom, true)
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

let _onQueueOpened: ((queueId: string, queueType: QueueType) => void) | null = null
let _onAnnotationSubmitted: ((scenarioId: string) => void) | null = null
let _onSessionClosed: (() => void) | null = null
let _onNavigate: ((scenarioId: string, index: number) => void) | null = null

async function fetchBaseRevisionRows(params: {projectId: string; revisionId: string}) {
    const revision = await fetchRevisionWithTestcases({
        id: params.revisionId,
        projectId: params.projectId,
    })

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

    if (scope === "all") {
        return get(scenarioIdsAtom)
    }

    if (scope === "complete") {
        const completed = get(completedScenarioIdsAtom)
        const records = get(scenarioRecordsAtom)
        return get(scenarioIdsAtom).filter((id) => isScenarioCompleted(id, completed, records))
    }

    return get(addToTestsetScenarioIdsAtom)
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

function collectColumnPathValues(
    data: Record<string, unknown>,
    values: {path: string; value: unknown}[],
    parentKey?: string,
) {
    for (const [key, value] of Object.entries(data)) {
        if (!parentKey && SYSTEM_FIELDS.has(key)) continue

        const columnKey = parentKey ? `${parentKey}.${key}` : key
        if (value && typeof value === "object" && !Array.isArray(value)) {
            collectColumnPathValues(value as Record<string, unknown>, values, columnKey)
            continue
        }

        values.push({path: columnKey, value})
    }
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
    for (const [key, value] of Object.entries(data)) {
        if (!parentKey && SYSTEM_FIELDS.has(key)) continue

        const columnKey = parentKey ? `${parentKey}.${key}` : key
        if (value && typeof value === "object" && !Array.isArray(value)) {
            collectDataColumnKeys(value as Record<string, unknown>, columns, columnKey)
            continue
        }

        columns.add(columnKey)
    }
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
    const latestRevision = await fetchLatestRevisionWithTestcases({
        projectId: params.projectId,
        testsetId: params.testsetId,
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
        const annotationSteps = store.get(evaluationRunMolecule.selectors.annotationSteps(runId))
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
        annotationsByTestcaseId.set(testcaseId, response.annotations ?? [])

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
                              requireAnnotationOutputScenarioIds: new Set(),
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

                    const patchResult = await patchRevision({
                        projectId,
                        testsetId: targetTestsetId,
                        baseRevisionId: latestRevision.id,
                        operations: {
                            rows: {
                                add: rowsForCommit.map((row) => ({data: row.data})),
                            },
                        },
                        message: payload.commitMessage,
                    })
                    committedRevisionId = patchResult?.testset_revision?.id
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
    const ids = get(scenarioIdsAtom)
    return ids.length > 0
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
    _onAnnotationSubmitted = callbacks.onAnnotationSubmitted ?? null
    _onSessionClosed = callbacks.onSessionClosed ?? null
    _onNavigate = callbacks.onNavigate ?? null
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
        /** Sync annotated data back to source testset as new revision */
        syncToTestset: syncToTestsetsAtom,
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
        syncToTestset: () => getStore().set(syncToTestsetsAtom),
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
