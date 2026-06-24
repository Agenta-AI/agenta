/**
 * Add-to-testset + sync-to-testset export machinery for the annotation session.
 *
 * Extracted verbatim from `annotationSessionController.ts`. This module owns the
 * add-to-testset job/modal atoms, the export-prep helpers (column remapping,
 * trace/testcase row preparation), the add-to-testset action atoms, and the
 * sync-to-testset machinery. The session/queue/scenario state stays in
 * `annotationSessionController.ts`; shared atoms/selectors are imported back from
 * there.
 *
 * @packageDocumentation
 */

import type {Annotation} from "@agenta/entities/annotation"
import {queryAnnotations} from "@agenta/entities/annotation"
import {evaluationRunMolecule, queryEvaluationResults} from "@agenta/entities/evaluationRun"
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
} from "@agenta/entities/trace"
import {axios, getAgentaApiUrl, queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {atom, type Getter} from "jotai"
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

import {
    activeQueueIdAtom,
    activeRunIdAtom,
    completedScenarioIdsAtom,
    extractAnnotationTraceIdsFromSteps,
    getStore,
    queueKindAtom,
    queueNameAtom,
    scenarioAnnotationsAtomFamily,
    scenarioAnnotationsQueryStateAtomFamily,
    scenarioIdsAtom,
    scenarioRecordsAtom,
    scenarioStepsQueryStateAtomFamily,
    scenarioTestcaseRefAtomFamily,
    scenarioTraceRefAtomFamily,
    testsetSyncEvaluatorsAtom,
} from "./annotationSessionController"

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

export {
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
}

export type {AddScenariosToTestsetPayload}
