import type {Annotation} from "@agenta/entities/annotation"
import type {Testcase} from "@agenta/entities/testcase"
import type {TestsetRevisionDelta} from "@agenta/entities/testset"

export const TESTCASE_QUEUE_KIND_TAG = "agenta:queue-kind:testcases"

export interface TestsetSyncConflict {
    code:
        | "missing_testcase"
        | "missing_testset"
        | "duplicate_queue_annotations"
        | "duplicate_legacy_annotations"
        | "missing_latest_revision"
    scenarioId: string
    testcaseId?: string
    testsetId?: string
    evaluatorSlug?: string
    message: string
}

export interface TestsetSyncRow {
    scenarioId: string
    testcaseId: string
    testsetId: string
    rowId: string
    evaluatorColumnKeys: string[]
    data: Record<string, unknown>
}

export interface TestsetSyncTarget {
    testsetId: string
    baseRevisionId: string
    rowCount: number
    columns: string[]
    rows: TestsetSyncRow[]
}

export interface TestsetSyncPreview {
    exportableRows: number
    skippedRows: number
    targets: TestsetSyncTarget[]
    conflicts: TestsetSyncConflict[]
    hasBlockingConflicts: boolean
}

export interface TestsetSyncEvaluator {
    slug: string
    name?: string | null
    workflowId?: string | null
}

export interface QueueScopedAnnotationSelection {
    annotation: Annotation | null
    conflictCode: Extract<
        TestsetSyncConflict["code"],
        "duplicate_queue_annotations" | "duplicate_legacy_annotations"
    > | null
}

export interface CompletedScenarioRef {
    scenarioId: string
    testcaseId: string
}

interface BuildTestsetSyncPreviewParams {
    queueId: string
    completedScenarios: CompletedScenarioRef[]
    testcasesById: Map<string, Testcase>
    annotationsByTestcaseId: Map<string, Annotation[]>
    evaluators: TestsetSyncEvaluator[]
    latestRevisionIdsByTestsetId: Map<string, string>
}

interface BaseRevisionTestcaseRow {
    id?: string | null
    data?: Record<string, unknown> | null
}

export function getQueueAnnotationTag(queueId: string) {
    return `agenta:queue:${queueId}`
}

function getAnnotationTags(annotation: Annotation): string[] {
    return Array.isArray(annotation.meta?.tags) ? annotation.meta.tags.filter(Boolean) : []
}

function hasQueueAnnotationTag(annotation: Annotation, queueId: string): boolean {
    const tags = getAnnotationTags(annotation)
    return tags.includes(getQueueAnnotationTag(queueId))
}

function hasAnyQueueAnnotationTag(annotation: Annotation): boolean {
    return getAnnotationTags(annotation).some((tag) => tag.startsWith("agenta:queue:"))
}

function isLegacyQueueAnnotation(annotation: Annotation): boolean {
    const tags = getAnnotationTags(annotation)
    return !tags.includes(TESTCASE_QUEUE_KIND_TAG) && !hasAnyQueueAnnotationTag(annotation)
}

function resolveAnnotationEvaluatorSlug(
    annotation: Annotation,
    slugByEvaluatorId: Map<string, string>,
): string | null {
    const evaluatorRef = annotation.references?.evaluator
    if (evaluatorRef?.slug) return evaluatorRef.slug
    if (evaluatorRef?.id) return slugByEvaluatorId.get(evaluatorRef.id) ?? null
    return null
}

function matchesAnnotationEvaluator(params: {
    annotation: Annotation
    evaluatorSlug: string
    evaluatorWorkflowId?: string | null
    slugByEvaluatorId: Map<string, string>
}): boolean {
    const evaluatorRef = params.annotation.references?.evaluator
    if (!evaluatorRef) return false

    if (params.evaluatorWorkflowId && evaluatorRef.id === params.evaluatorWorkflowId) {
        return true
    }

    const resolvedSlug = resolveAnnotationEvaluatorSlug(params.annotation, params.slugByEvaluatorId)
    return resolvedSlug === params.evaluatorSlug
}

export function mergeTestcaseAnnotationTags(params: {
    queueId: string
    existingTags?: string[] | null
    outputKeys?: string[]
}): string[] {
    const next = new Set<string>()

    for (const tag of params.existingTags ?? []) {
        if (tag) next.add(tag)
    }

    for (const key of params.outputKeys ?? []) {
        if (key) next.add(key)
    }

    next.add(TESTCASE_QUEUE_KIND_TAG)
    next.add(getQueueAnnotationTag(params.queueId))

    return Array.from(next)
}

export function selectQueueScopedAnnotation(params: {
    annotations: Annotation[]
    queueId: string
    evaluatorSlug: string
    evaluatorWorkflowId?: string | null
}): QueueScopedAnnotationSelection {
    const slugByEvaluatorId = new Map<string, string>()
    if (params.evaluatorWorkflowId) {
        slugByEvaluatorId.set(params.evaluatorWorkflowId, params.evaluatorSlug)
    }

    const matching = params.annotations.filter((annotation) => {
        return matchesAnnotationEvaluator({
            annotation,
            evaluatorSlug: params.evaluatorSlug,
            evaluatorWorkflowId: params.evaluatorWorkflowId,
            slugByEvaluatorId,
        })
    })

    if (matching.length === 0) {
        return {annotation: null, conflictCode: null}
    }

    const queueScoped = matching.filter((annotation) =>
        hasQueueAnnotationTag(annotation, params.queueId),
    )
    if (queueScoped.length === 1) {
        return {annotation: queueScoped[0] ?? null, conflictCode: null}
    }
    if (queueScoped.length > 1) {
        return {annotation: null, conflictCode: "duplicate_queue_annotations"}
    }

    const legacy = matching.filter(isLegacyQueueAnnotation)
    if (legacy.length === 1) {
        return {annotation: legacy[0] ?? null, conflictCode: null}
    }
    if (legacy.length > 1) {
        return {annotation: null, conflictCode: "duplicate_legacy_annotations"}
    }

    return {annotation: null, conflictCode: null}
}

export function buildTestsetSyncPreview(params: BuildTestsetSyncPreviewParams): TestsetSyncPreview {
    const conflicts: TestsetSyncConflict[] = []
    const rows: TestsetSyncRow[] = []
    const slugByEvaluatorId = new Map<string, string>()

    for (const evaluator of params.evaluators) {
        if (evaluator.workflowId) {
            slugByEvaluatorId.set(evaluator.workflowId, evaluator.slug)
        }
    }

    for (const completed of params.completedScenarios) {
        const testcase = params.testcasesById.get(completed.testcaseId)

        if (!testcase) {
            conflicts.push({
                code: "missing_testcase",
                scenarioId: completed.scenarioId,
                testcaseId: completed.testcaseId,
                message: "The source testcase could not be loaded.",
            })
            continue
        }

        const testsetId = testcase.testset_id ?? testcase.set_id ?? undefined
        if (!testsetId) {
            conflicts.push({
                code: "missing_testset",
                scenarioId: completed.scenarioId,
                testcaseId: completed.testcaseId,
                message: "The source testcase is not linked to a testset.",
            })
            continue
        }

        const annotations = params.annotationsByTestcaseId.get(completed.testcaseId) ?? []
        const selected: {columnKey: string; outputs: Record<string, unknown>}[] = []
        let hasConflict = false

        for (const evaluator of params.evaluators) {
            const selection = selectQueueScopedAnnotation({
                annotations,
                queueId: params.queueId,
                evaluatorSlug: evaluator.slug,
                evaluatorWorkflowId: evaluator.workflowId,
            })

            if (selection.conflictCode) {
                hasConflict = true
                conflicts.push({
                    code: selection.conflictCode,
                    scenarioId: completed.scenarioId,
                    testcaseId: completed.testcaseId,
                    testsetId,
                    evaluatorSlug: evaluator.slug,
                    message:
                        selection.conflictCode === "duplicate_queue_annotations"
                            ? `Multiple queue-scoped annotations were found for evaluator "${evaluator.name ?? evaluator.slug}".`
                            : `Multiple legacy annotations were found for evaluator "${evaluator.name ?? evaluator.slug}".`,
                })
                continue
            }

            if (!selection.annotation) continue

            const resolvedSlug =
                resolveAnnotationEvaluatorSlug(selection.annotation, slugByEvaluatorId) ??
                evaluator.slug
            const outputs =
                selection.annotation.data?.outputs &&
                typeof selection.annotation.data.outputs === "object"
                    ? (selection.annotation.data.outputs as Record<string, unknown>)
                    : {}

            if (Object.keys(outputs).length === 0) continue

            selected.push({
                columnKey: evaluator.name?.trim() || resolvedSlug,
                outputs,
            })
        }

        if (hasConflict || selected.length === 0) {
            continue
        }

        const evaluatorColumnKeys = selected.map((entry) => entry.columnKey)
        const data: Record<string, unknown> = {...(testcase.data ?? {})}

        for (const entry of selected) {
            data[entry.columnKey] = entry.outputs
        }

        rows.push({
            scenarioId: completed.scenarioId,
            testcaseId: completed.testcaseId,
            testsetId,
            rowId: testcase.id,
            evaluatorColumnKeys,
            data,
        })
    }

    const targetsByTestsetId = new Map<
        string,
        {
            testsetId: string
            rowCount: number
            columns: Set<string>
            rows: TestsetSyncRow[]
        }
    >()

    for (const row of rows) {
        const target = targetsByTestsetId.get(row.testsetId) ?? {
            testsetId: row.testsetId,
            rowCount: 0,
            columns: new Set<string>(),
            rows: [],
        }

        target.rowCount += 1
        target.rows.push(row)
        row.evaluatorColumnKeys.forEach((columnKey) => target.columns.add(columnKey))
        targetsByTestsetId.set(row.testsetId, target)
    }

    const targets: TestsetSyncTarget[] = []
    for (const target of targetsByTestsetId.values()) {
        const baseRevisionId = params.latestRevisionIdsByTestsetId.get(target.testsetId)

        if (!baseRevisionId) {
            conflicts.push({
                code: "missing_latest_revision",
                scenarioId: target.rows[0]?.scenarioId ?? "",
                testcaseId: target.rows[0]?.testcaseId,
                testsetId: target.testsetId,
                message: "The latest revision for this testset could not be resolved.",
            })
            continue
        }

        targets.push({
            testsetId: target.testsetId,
            baseRevisionId,
            rowCount: target.rowCount,
            columns: Array.from(target.columns),
            rows: target.rows,
        })
    }

    const exportableRows = targets.reduce((sum, target) => sum + target.rowCount, 0)

    return {
        exportableRows,
        skippedRows: Math.max(params.completedScenarios.length - exportableRows, 0),
        targets,
        conflicts,
        hasBlockingConflicts: targets.length === 0 || exportableRows === 0,
    }
}

export function buildTestsetSyncOperations(target: TestsetSyncTarget): TestsetRevisionDelta {
    return {
        columns: target.columns.length > 0 ? {add: target.columns} : undefined,
        rows: {
            replace: target.rows.map((row) => ({
                id: row.rowId,
                data: row.data,
            })),
        },
    }
}

function getTestcaseDedupId(data: Record<string, unknown> | null | undefined): string | null {
    if (!data) return null

    const raw = data.testcase_dedup_id ?? data.__dedup_id__
    return typeof raw === "string" && raw.length > 0 ? raw : null
}

export function remapTargetRowsToBaseRevision(params: {
    target: TestsetSyncTarget
    baseRows: BaseRevisionTestcaseRow[]
}) {
    const baseRowIds = new Set<string>()
    const baseRowIdByDedup = new Map<string, string>()

    for (const row of params.baseRows) {
        if (row.id) {
            baseRowIds.add(row.id)
        }

        const dedupId = getTestcaseDedupId(row.data)
        if (row.id && dedupId) {
            baseRowIdByDedup.set(dedupId, row.id)
        }
    }

    const mappedRows: TestsetSyncRow[] = []
    let droppedRowCount = 0

    for (const row of params.target.rows) {
        if (baseRowIds.has(row.rowId)) {
            mappedRows.push(row)
            continue
        }

        const dedupId = getTestcaseDedupId(row.data)
        const mappedRowId = dedupId ? baseRowIdByDedup.get(dedupId) : null

        if (!mappedRowId) {
            droppedRowCount += 1
            continue
        }

        mappedRows.push({
            ...row,
            rowId: mappedRowId,
        })
    }

    return {
        target: {
            ...params.target,
            rowCount: mappedRows.length,
            rows: mappedRows,
        },
        droppedRowCount,
    }
}
