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
    data: Record<string, unknown>
}

export interface TestsetSyncTarget {
    testsetId: string
    baseRevisionId: string
    rowCount: number
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

export interface TraceTestsetRowBuilderParams {
    scenarioIds: string[]
    traceInputsByScenario: Map<string, Record<string, unknown>>
    traceOutputsByScenario: Map<string, unknown>
    annotationsByScenario: Map<string, Record<string, Record<string, unknown>>>
    outputColumnName: string
}

export interface TraceTestsetRow {
    scenarioId: string
    data: Record<string, unknown>
}

export interface TestcaseExportRowBuilderParams {
    scenarioIds: string[]
    testcasesByScenarioId: Map<string, Testcase>
    annotationsByTestcaseId: Map<string, Annotation[]>
    evaluators: TestsetSyncEvaluator[]
    queueId: string
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

function getAnnotationOutputs(annotation: Annotation): Record<string, unknown> {
    const outputs = annotation.data?.outputs
    return outputs && typeof outputs === "object" && !Array.isArray(outputs)
        ? (outputs as Record<string, unknown>)
        : {}
}

function buildSlugByEvaluatorId(evaluators: TestsetSyncEvaluator[]): Map<string, string> {
    const slugByEvaluatorId = new Map<string, string>()

    for (const evaluator of evaluators) {
        if (evaluator.workflowId) {
            slugByEvaluatorId.set(evaluator.workflowId, evaluator.slug)
        }
    }

    return slugByEvaluatorId
}

export function getTestsetSyncEvaluatorColumnKey(params: {
    evaluator: TestsetSyncEvaluator
    annotation?: Annotation | null
    slugByEvaluatorId?: Map<string, string>
}): string {
    const resolvedSlug = params.annotation
        ? resolveAnnotationEvaluatorSlug(
              params.annotation,
              params.slugByEvaluatorId ?? buildSlugByEvaluatorId([params.evaluator]),
          )
        : null

    return (
        resolvedSlug?.trim() ||
        params.evaluator.slug?.trim() ||
        params.evaluator.workflowId?.trim() ||
        ""
    )
}

function buildAnnotationOutputEntries(params: {
    annotations: Annotation[]
    evaluators: TestsetSyncEvaluator[]
    queueId: string
}): {columnKey: string; outputs: Record<string, unknown>}[] {
    const entries: {columnKey: string; outputs: Record<string, unknown>}[] = []
    const slugByEvaluatorId = buildSlugByEvaluatorId(params.evaluators)

    for (const evaluator of params.evaluators) {
        const selection = selectQueueScopedAnnotation({
            annotations: params.annotations,
            queueId: params.queueId,
            evaluatorSlug: evaluator.slug,
            evaluatorWorkflowId: evaluator.workflowId,
        })

        if (!selection.annotation || selection.conflictCode) continue

        const outputs = getAnnotationOutputs(selection.annotation)
        if (Object.keys(outputs).length === 0) continue

        const columnKey = getTestsetSyncEvaluatorColumnKey({
            evaluator,
            annotation: selection.annotation,
            slugByEvaluatorId,
        })
        if (!columnKey) continue

        entries.push({
            columnKey,
            outputs,
        })
    }

    return entries
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function applyAnnotationOutputEntries(
    data: Record<string, unknown>,
    entries: {columnKey: string; outputs: Record<string, unknown>}[],
): void {
    for (const entry of entries) {
        const existingValue = data[entry.columnKey]
        data[entry.columnKey] = {
            ...(isPlainRecord(existingValue) ? existingValue : {}),
            ...entry.outputs,
        }
    }
}

function expandInputsColumn(data: Record<string, unknown>): Record<string, unknown> {
    const {inputs, ...rest} = data

    if (!isPlainRecord(inputs)) {
        return {...data}
    }

    return {
        ...inputs,
        ...rest,
    }
}

function hasMessageIdentity(value: Record<string, unknown>): boolean {
    return (
        typeof value.role === "string" ||
        typeof value.sender === "string" ||
        typeof value.author === "string"
    )
}

function stringifyToolCallArguments(value: unknown): string {
    if (typeof value === "string") return value
    if (value === null || value === undefined) return ""

    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function unwrapValueField(value: unknown): unknown {
    return isPlainRecord(value) && "value" in value ? value.value : value
}

function asArrayField(value: unknown): unknown[] | null {
    const unwrapped = unwrapValueField(value)
    return Array.isArray(unwrapped) ? unwrapped : null
}

function extractTextParts(value: unknown): string {
    if (!Array.isArray(value)) return ""

    return value
        .map((part) => {
            if (typeof part === "string") return part
            if (!isPlainRecord(part)) return ""
            if (typeof part.text === "string") return part.text
            if (typeof part.content === "string") return part.content
            return ""
        })
        .filter(Boolean)
        .join("\n")
}

function normalizeMessageContentValue(value: unknown): unknown {
    const unwrapped = unwrapValueField(value)
    if (Array.isArray(unwrapped)) {
        return extractTextParts(unwrapped) || unwrapped
    }
    return unwrapped
}

function getToolCallDisplay(value: unknown): string | null {
    if (!isPlainRecord(value)) return null

    const fn = value.function
    if (isPlainRecord(fn)) {
        const name = typeof fn.name === "string" && fn.name.trim() ? fn.name.trim() : "tool_call"
        const args = stringifyToolCallArguments(fn.arguments)
        return args ? `${name}(${args})` : name
    }

    const name =
        typeof value.name === "string" && value.name.trim()
            ? value.name.trim()
            : typeof value.type === "string" && value.type.trim()
              ? value.type.trim()
              : "tool_call"

    return name
}

function extractToolCallsDisplay(value: Record<string, unknown>): string {
    const toolCalls = asArrayField(value.tool_calls) ?? asArrayField(value.toolCalls)
    if (toolCalls?.length) {
        return toolCalls
            .map(getToolCallDisplay)
            .filter((display): display is string => Boolean(display))
            .join("\n")
    }

    const functionCall = value.function_call ?? value.functionCall
    if (isPlainRecord(functionCall)) {
        return getToolCallDisplay({function: functionCall}) ?? ""
    }

    return ""
}

function extractDirectMessageContent(value: Record<string, unknown>): {
    found: boolean
    content: unknown
} {
    if ("content" in value) {
        return {found: true, content: normalizeMessageContentValue(value.content)}
    }

    if ("text" in value) {
        return {found: true, content: normalizeMessageContentValue(value.text)}
    }

    if ("message" in value && !isPlainRecord(value.message)) {
        return {found: true, content: normalizeMessageContentValue(value.message)}
    }

    const delta = value.delta
    if (isPlainRecord(delta) && "content" in delta) {
        return {found: true, content: normalizeMessageContentValue(delta.content)}
    }

    if ("parts" in value) {
        return {found: true, content: normalizeMessageContentValue(value.parts)}
    }

    return {found: false, content: undefined}
}

function extractKnownOutputMessage(value: Record<string, unknown>): unknown {
    const completion = value.completion
    if (Array.isArray(completion) && completion.length > 0) {
        return completion[completion.length - 1]
    }

    const outputMessages = value.output_messages ?? value.outputMessages
    if (Array.isArray(outputMessages) && outputMessages.length > 0) {
        return outputMessages[outputMessages.length - 1]
    }

    const responses = value.responses
    if (Array.isArray(responses) && responses.length > 0) {
        return responses[responses.length - 1]
    }

    return undefined
}

function extractMessageContent(value: unknown): {matched: boolean; content: unknown} {
    if (!isPlainRecord(value)) {
        return {matched: false, content: value}
    }

    const toolCallsDisplay = extractToolCallsDisplay(value)

    if (hasMessageIdentity(value)) {
        const directContent = extractDirectMessageContent(value)
        if (directContent.found) {
            return {
                matched: true,
                content: directContent.content || toolCallsDisplay,
            }
        }

        if (toolCallsDisplay) {
            return {matched: true, content: toolCallsDisplay}
        }

        return {matched: true, content: ""}
    }

    if (toolCallsDisplay) {
        return {matched: true, content: toolCallsDisplay}
    }

    const nestedMessage = value.message
    if (isPlainRecord(nestedMessage)) {
        const nested = extractMessageContent(nestedMessage)
        if (nested.matched) return nested
    }

    const knownOutputMessage = extractKnownOutputMessage(value)
    if (knownOutputMessage !== undefined) {
        const output = extractMessageContent(knownOutputMessage)
        if (output.matched) return output
    }

    const choices = value.choices
    const firstChoice = Array.isArray(choices) ? choices[0] : null
    if (isPlainRecord(firstChoice)) {
        const choiceMessage = firstChoice.message ?? firstChoice.delta
        if (isPlainRecord(choiceMessage)) {
            const nested = extractMessageContent(choiceMessage)
            if (nested.matched) return nested
        }
    }

    return {matched: false, content: value}
}

function normalizeTraceOutputForTestset(value: unknown): unknown {
    if (isPlainRecord(value) && typeof value.error === "string" && value.error.trim()) {
        return value.error
    }

    const message = extractMessageContent(value)
    return message.matched ? message.content : value
}

export function buildTraceTestsetRows(params: TraceTestsetRowBuilderParams): TraceTestsetRow[] {
    return params.scenarioIds.map((scenarioId) => {
        const data: Record<string, unknown> = expandInputsColumn(
            params.traceInputsByScenario.get(scenarioId) ?? {},
        )

        data[params.outputColumnName] = normalizeTraceOutputForTestset(
            params.traceOutputsByScenario.get(scenarioId),
        )

        const annotationsByEvaluator = params.annotationsByScenario.get(scenarioId) ?? {}
        applyAnnotationOutputEntries(
            data,
            Object.entries(annotationsByEvaluator).map(([columnKey, outputs]) => ({
                columnKey,
                outputs,
            })),
        )

        return {scenarioId, data}
    })
}

export function buildTestcaseExportRows(params: TestcaseExportRowBuilderParams): TestsetSyncRow[] {
    const rows: TestsetSyncRow[] = []

    for (const scenarioId of params.scenarioIds) {
        const testcase = params.testcasesByScenarioId.get(scenarioId)
        if (!testcase) continue
        const testsetId = testcase.testset_id ?? testcase.set_id
        if (!testsetId) continue

        const data: Record<string, unknown> = expandInputsColumn(testcase.data ?? {})
        const annotations = params.annotationsByTestcaseId.get(testcase.id) ?? []
        const entries = buildAnnotationOutputEntries({
            annotations,
            evaluators: params.evaluators,
            queueId: params.queueId,
        })
        if (entries.length === 0) continue

        applyAnnotationOutputEntries(data, entries)

        rows.push({
            scenarioId,
            testcaseId: testcase.id,
            testsetId,
            rowId: testcase.id,
            data,
        })
    }

    return rows
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
    const slugByEvaluatorId = buildSlugByEvaluatorId(params.evaluators)

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

            const outputs = getAnnotationOutputs(selection.annotation)

            if (Object.keys(outputs).length === 0) continue
            const columnKey = getTestsetSyncEvaluatorColumnKey({
                evaluator,
                annotation: selection.annotation,
                slugByEvaluatorId,
            })
            if (!columnKey) continue

            selected.push({
                columnKey,
                outputs,
            })
        }

        if (hasConflict || selected.length === 0) {
            continue
        }

        const data: Record<string, unknown> = {...(testcase.data ?? {})}
        applyAnnotationOutputEntries(data, selected)

        rows.push({
            scenarioId: completed.scenarioId,
            testcaseId: completed.testcaseId,
            testsetId,
            rowId: testcase.id,
            data,
        })
    }

    const targetsByTestsetId = new Map<
        string,
        {
            testsetId: string
            rowCount: number
            rows: TestsetSyncRow[]
        }
    >()

    for (const row of rows) {
        const target = targetsByTestsetId.get(row.testsetId) ?? {
            testsetId: row.testsetId,
            rowCount: 0,
            rows: [],
        }

        target.rowCount += 1
        target.rows.push(row)
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
