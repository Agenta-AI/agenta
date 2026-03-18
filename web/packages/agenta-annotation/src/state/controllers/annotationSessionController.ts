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
import {queryAnnotations, queryAnnotationsByInvocationLink} from "@agenta/entities/annotation"
import {evaluationRunMolecule} from "@agenta/entities/evaluationRun"
import {evaluatorMolecule} from "@agenta/entities/evaluator"
import type {QueueType} from "@agenta/entities/queue"
import {registerQueueTypeHint, clearQueueTypeHint} from "@agenta/entities/queue"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {fetchTestcase, fetchTestcasesBatch} from "@agenta/entities/testcase"
import type {Testcase} from "@agenta/entities/testcase"
import {
    fetchLatestRevisionsBatch,
    fetchRevisionWithTestcases,
    patchRevision,
} from "@agenta/entities/testset"
import {
    traceEntityAtomFamily,
    traceInputsAtomFamily,
    traceRootSpanAtomFamily,
    type TraceSpan,
} from "@agenta/entities/trace"
import {axios} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atom, type Getter, type Setter} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    buildTestsetSyncOperations,
    buildTestsetSyncPreview,
    remapTargetRowsToBaseRevision,
    selectQueueScopedAnnotation,
    type CompletedScenarioRef,
    type TestsetSyncEvaluator,
} from "../testsetSync"
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

/** Full scenario records — derived from simpleQueueMolecule.selectors.scenarios */
type ScenarioRecord = Record<string, unknown>
const scenarioRecordsAtom = atom<ScenarioRecord[]>((get) => {
    const queueId = get(activeQueueIdAtom)
    if (!queueId) return []
    return get(simpleQueueMolecule.selectors.scenarios(queueId)) as ScenarioRecord[]
})

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
    const ids = get(navigableScenarioIdsAtom)
    if (ids.length === 0) return null

    const focusedScenarioId = get(focusedScenarioIdAtom)
    if (focusedScenarioId && ids.includes(focusedScenarioId)) {
        return focusedScenarioId
    }

    return ids[0] ?? null
})

/** Current scenario index (0-based) */
const currentScenarioIndexAtom = atom<number>((get) => {
    const ids = get(navigableScenarioIdsAtom)
    const currentScenarioId = get(currentScenarioIdAtom)

    if (!currentScenarioId) return 0

    const index = ids.indexOf(currentScenarioId)
    return index >= 0 ? index : 0
})

/** Can navigate to next item? */
const hasNextAtom = atom<boolean>((get) => {
    const idx = get(currentScenarioIndexAtom)
    return idx < get(navigableScenarioIdsAtom).length - 1
})

/** Can navigate to previous item? */
const hasPrevAtom = atom<boolean>((get) => {
    return get(currentScenarioIndexAtom) > 0
})

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

/** Evaluator metadata for queue-scoped testcase sync. */
const testsetSyncEvaluatorsAtom = atom<TestsetSyncEvaluator[]>((get) => {
    const runId = get(activeRunIdAtom)
    if (!runId) return []

    const byKey = new Map<string, TestsetSyncEvaluator>()
    const annotationSteps = get(evaluationRunMolecule.selectors.annotationSteps(runId))

    for (const step of annotationSteps) {
        const workflowId = step.references?.evaluator?.id ?? null
        const evaluatorEntity = workflowId
            ? get(evaluatorMolecule.selectors.data(workflowId))
            : null
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

    return Object.keys(inputs)
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
 * Testcase input keys — discovered from the first scenario's testcase data.
 * Used by the list view to build per-key columns for testcase-based queues.
 *
 * Reactively resolves: scenarioIds[0] → testcaseRef → testcaseData → Object.keys(data)
 */
const testcaseInputKeysAtom = atom<string[]>((get) => {
    const kind = get(queueKindAtom)
    if (kind !== "testcases") return []

    const ids = get(scenarioIdsAtom)
    if (ids.length === 0) return []

    const firstScenarioId = ids[0]
    const ref = get(scenarioTestcaseRefAtomFamily(firstScenarioId))
    if (!ref.testcaseId) return []

    const query = get(testcaseDataAtomFamily(ref.testcaseId))
    const testcase = query?.data
    if (!testcase?.data) return []

    return Object.keys(testcase.data).filter((key) => !TESTCASE_SYSTEM_KEYS.has(key))
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
const OUTPUT_KEYS = new Set(["output", "outputs", "result", "response", "completion"])

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
// EVALUATOR OUTPUT KEY HELPERS
// ============================================================================

/** Safely access a nested path on an object */
function getNestedValue(obj: unknown, ...keys: string[]): unknown {
    let current: unknown = obj
    for (const key of keys) {
        if (!current || typeof current !== "object") return undefined
        current = (current as Record<string, unknown>)[key]
    }
    return current
}

/**
 * Resolve output schema from evaluator data, checking multiple legacy paths.
 * Returns the `properties` keys from the first valid output schema found.
 */
/**
 * Resolve output schema properties from evaluator data.
 * Returns the full properties object (key → schema) so callers can inspect types.
 */
function resolveOutputProperties(
    data: Record<string, unknown> | null | undefined,
): Record<string, Record<string, unknown>> | null {
    if (!data) return null
    const candidates = [
        getNestedValue(data, "schemas", "outputs"),
        getNestedValue(data, "service", "format", "properties", "outputs"),
        getNestedValue(data, "service", "configuration", "outputs"),
        getNestedValue(data, "configuration", "outputs"),
        getNestedValue(data, "service", "configuration", "format", "properties", "outputs"),
        getNestedValue(data, "configuration", "format", "properties", "outputs"),
    ]
    for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") {
            const properties = (candidate as Record<string, unknown>).properties
            if (properties && typeof properties === "object") {
                return properties as Record<string, Record<string, unknown>>
            }
        }
    }
    return null
}

/** Output schema types that are not aggregatable in list view (string, free text) */
const NON_AGGREGATABLE_OUTPUT_TYPES = new Set(["string"])

function isAggregatableOutputProperty(schema: Record<string, unknown>): boolean {
    const type = schema.type
    if (typeof type === "string" && NON_AGGREGATABLE_OUTPUT_TYPES.has(type)) return false
    return true
}

function resolveOutputKeys(data: Record<string, unknown> | null | undefined): string[] {
    const properties = resolveOutputProperties(data)
    if (!properties) return []
    return Object.entries(properties)
        .filter(([, schema]) => isAggregatableOutputProperty(schema))
        .map(([key]) => key)
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
            const discovered = discoverTestcaseColumns(records)
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

    // Annotation columns — resolve output keys from evaluator entity data
    const annotationColumns: ScenarioListColumnDef[] = annotationDefs.map((def) => {
        let outputKeys: string[] = []
        if (def.evaluatorId) {
            const evaluator = get(evaluatorMolecule.selectors.data(def.evaluatorId))
            outputKeys = resolveOutputKeys(evaluator?.data as Record<string, unknown> | null)
        }
        const subColumnCount = outputKeys.length > 1 ? outputKeys.length : 1
        return {
            columnType: "annotation" as const,
            key: `__annot_${def.stepKey}`,
            title: def.columnName || def.evaluatorSlug || def.stepKey,
            width: 150 * subColumnCount,
            annotationDef: def,
            outputKeys,
        }
    })

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
const scenarioTraceRefAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const runId = get(activeRunIdAtom)
        if (!runId || !scenarioId) return {traceId: "", spanId: ""}
        return get(evaluationRunMolecule.selectors.scenarioTraceRef({runId, scenarioId}))
    }),
)

/**
 * Testcase ref for a scenario — derived from evaluation run steps.
 * Resolves testcase_id from the scenario's step results.
 */
const scenarioTestcaseRefAtomFamily = atomFamily((scenarioId: string) =>
    atom((get) => {
        const runId = get(activeRunIdAtom)
        if (!runId || !scenarioId) return {testcaseId: ""}
        return get(evaluationRunMolecule.selectors.scenarioTestcaseRef({runId, scenarioId}))
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

        // Get annotation step keys from the run definition
        const annotationSteps = get(evaluationRunMolecule.selectors.annotationSteps(runId))
        const annotationStepKeys = new Set(annotationSteps.map((s) => s.key))
        if (annotationStepKeys.size === 0) return []

        // Get scenario step results (evaluation results)
        const stepsQuery = get(evaluationRunMolecule.selectors.scenarioSteps({runId, scenarioId}))
        const steps = stepsQuery.data ?? []

        // Extract trace_ids from annotation step results
        const traceIds: string[] = []
        for (const step of steps) {
            if (step.step_key && annotationStepKeys.has(step.step_key) && step.trace_id) {
                traceIds.push(step.trace_id)
            }
        }
        return traceIds
    }),
)

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
 * Link-based annotation query — finds annotations by the invocation trace they reference.
 * This is the fallback path when annotation step results don't exist
 * (e.g., the step result upsert failed silently after annotation creation).
 */
const scenarioAnnotationsByLinkQueryAtomFamily = atomFamily(
    ({scenarioId, traceId}: {scenarioId: string; traceId: string}) =>
        atomWithQuery(() => ({
            queryKey: ["scenarioAnnotationsByLink", scenarioId, traceId],
            queryFn: async (): Promise<Annotation[]> => {
                const projectId = getStore().get(projectIdAtom)
                if (!projectId || !traceId) return []
                const response = await queryAnnotationsByInvocationLink({
                    projectId,
                    traceId,
                })
                return response.annotations ?? []
            },
            enabled: !!traceId,
            retry: (failureCount: number, error: Error) => {
                if (error?.message === "projectId not yet available" && failureCount < 5) {
                    return true
                }
                return false
            },
            retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 2000),
            staleTime: 30_000,
        })),
    (a: {scenarioId: string; traceId: string}, b: {scenarioId: string; traceId: string}) =>
        a.scenarioId === b.scenarioId && a.traceId === b.traceId,
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
 * Uses three resolution paths:
 * 1. **Step-based** (primary): Extract annotation trace_ids from evaluation run step results
 * 2. **Link-based** (fallback): Query annotations whose `links` reference the invocation trace
 * 3. **Testcase-based** (fallback): Query annotations by testcase reference (for testcase queues)
 *
 * The fallback paths only fire when previous paths return empty.
 */
const scenarioAnnotationsAtomFamily = atomFamily((scenarioId: string) =>
    atom<Annotation[]>((get) => {
        // Path 1: Step-based resolution (primary)
        const traceIds = get(scenarioAnnotationTraceIdsAtomFamily(scenarioId))
        if (traceIds.length > 0) {
            const annotationTraceIds = traceIds.join("|")
            const query = get(scenarioAnnotationsQueryAtomFamily({scenarioId, annotationTraceIds}))
            const stepAnnotations = query.data ?? []
            // If step-based found results, use those (canonical path)
            if (stepAnnotations.length > 0) {
                return stepAnnotations
            }
        }

        // Path 2: Link-based resolution (fallback only when step-based is empty)
        const traceRef = get(scenarioTraceRefAtomFamily(scenarioId))
        if (traceRef.traceId) {
            const linkQuery = get(
                scenarioAnnotationsByLinkQueryAtomFamily({
                    scenarioId,
                    traceId: traceRef.traceId,
                }),
            )
            return linkQuery.data ?? []
        }

        // Path 3: Testcase-based resolution (for testcase queues without trace_id)
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

// ============================================================================
// EVALUATION METRICS (per-scenario)
// ============================================================================

/**
 * Metrics data for a single scenario, fetched from
 * `POST /preview/evaluations/metrics/query`.
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
 * Per-scenario metrics query — fetches from `POST /preview/evaluations/metrics/query`.
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
                    `/preview/evaluations/metrics/query`,
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
async function invalidateScenarioAnnotations(scenarioId: string) {
    const store = getStore()
    const runId = store.get(activeRunIdAtom)

    // Step 1: Refetch scenario steps FIRST (awaited).
    // The new annotation creates a new step result with the annotation's trace_id.
    // We must wait for this to complete so scenarioAnnotationTraceIdsAtomFamily
    // derives the correct trace IDs for step 2.
    if (runId) {
        const stepsQuery = store.get(
            evaluationRunMolecule.selectors.scenarioSteps({runId, scenarioId}),
        )
        if (stepsQuery?.refetch) {
            try {
                await stepsQuery.refetch()
            } catch {
                // Non-critical — fallback link-based query will catch these
            }
        }
    }

    // Step 2: Refetch annotation queries (awaited).
    // Now that steps are updated, scenarioAnnotationTraceIdsAtomFamily has fresh data.
    const traceIds = store.get(scenarioAnnotationTraceIdsAtomFamily(scenarioId))
    if (traceIds.length > 0) {
        const annotationTraceIds = traceIds.join("|")
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

    // Also refetch link-based annotation query (fallback path)
    const traceRef = store.get(scenarioTraceRefAtomFamily(scenarioId))
    if (traceRef.traceId) {
        const linkQuery = store.get(
            scenarioAnnotationsByLinkQueryAtomFamily({
                scenarioId,
                traceId: traceRef.traceId,
            }),
        )
        if (linkQuery?.refetch) {
            try {
                await linkQuery.refetch()
            } catch {
                // Non-critical
            }
        }
    }

    // Step 3: Trigger metrics refresh then refetch (fire-and-forget, independent)
    const projectId = store.get(projectIdAtom)
    if (projectId && runId) {
        axios
            .post(
                `/preview/evaluations/metrics/refresh`,
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

    const currentScenarioId = get(currentScenarioIdAtom)
    const ids = getNavigableScenarioIds({get, view})
    if (currentScenarioId && ids.includes(currentScenarioId)) {
        set(focusedScenarioIdAtom, currentScenarioId)
        return
    }

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

    const ids = getNavigableScenarioIds({get, view: nextView})
    const requestedScenarioId =
        payload.scenarioId === undefined ? get(focusedScenarioIdAtom) : payload.scenarioId

    if (requestedScenarioId) {
        if (ids.length === 0) {
            set(focusedScenarioIdAtom, requestedScenarioId)
            return
        }

        if (ids.includes(requestedScenarioId)) {
            setFocusedScenarioId({get, set, scenarioId: requestedScenarioId, notify: true})
            return
        }
    }

    if (ids.length === 0) {
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
    set(activeSessionViewAtom, "annotate")
    set(hideCompletedInFocusAtom, false)
    set(focusAutoNextAtom, true)

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
        /** Evaluator workflow IDs from evaluation run annotation steps */
        evaluatorIds: () => evaluatorIdsAtom,
        /** Evaluator revision IDs from evaluation run annotation steps */
        evaluatorRevisionIds: () => evaluatorRevisionIdsAtom,
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
        /** Testcase ref (testcaseId) for a scenario */
        scenarioTestcaseRef: scenarioTestcaseRefAtomFamily,
        /** Full trace query state for a scenario */
        scenarioTraceQuery: scenarioTraceQueryAtomFamily,
        /** Root span for a scenario */
        scenarioRootSpan: scenarioRootSpanAtomFamily,
        /** Annotations for a scenario */
        scenarioAnnotations: scenarioAnnotationsAtomFamily,
        /** Evaluation metrics for a scenario (from /evaluations/metrics/query) */
        scenarioMetrics: scenarioMetricsAtomFamily,
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
        scenarioStatuses: () => getStore().get(scenarioStatusesAtom),
        evaluatorIds: () => getStore().get(evaluatorIdsAtom),
        evaluatorRevisionIds: () => getStore().get(evaluatorRevisionIdsAtom),
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
        scenarioTestcaseRef: (scenarioId: string) =>
            getStore().get(scenarioTestcaseRefAtomFamily(scenarioId)),
        scenarioRootSpan: (scenarioId: string) =>
            getStore().get(scenarioRootSpanAtomFamily(scenarioId)),
        scenarioAnnotations: (scenarioId: string) =>
            getStore().get(scenarioAnnotationsAtomFamily(scenarioId)),
        scenarioMetrics: (scenarioId: string) =>
            getStore().get(scenarioMetricsAtomFamily(scenarioId)),
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
