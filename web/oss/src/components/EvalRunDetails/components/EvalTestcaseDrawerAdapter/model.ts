import type {TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"

import type {EvaluationTableColumn, EvaluationTableColumnGroup} from "../../atoms/table"

export interface EvalDrawerItemIdentity {
    drawerItemId: string
    sourceTestcaseId: string | null
    displayId: string
}

export function buildEvalDrawerItemIdentity({
    scenarioId,
    sourceTestcaseId,
}: {
    scenarioId: string
    sourceTestcaseId?: string | null
}): EvalDrawerItemIdentity {
    const resolvedTestcaseId = sourceTestcaseId || null
    const drawerItemId = resolvedTestcaseId ?? scenarioId

    return {
        drawerItemId,
        sourceTestcaseId: resolvedTestcaseId,
        displayId: drawerItemId,
    }
}

export function mapEvalInputColumns(columns: EvaluationTableColumn[]): TestcaseDataEditorColumn[] {
    return columns.map((column) => {
        const key = column.valueKey || column.path || column.id
        const label = column.displayLabel ?? column.label ?? key

        return {
            key,
            name: label,
            label,
            pathMode: "auto",
        }
    })
}

export interface EvalDrawerOutputSection {
    id: string
    label: string
    stepKey?: string
    traceId?: string
    columns: EvaluationTableColumn[]
}

export interface EvalDrawerMetricSection {
    id: string
    label: string
    columns: EvaluationTableColumn[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

const getPathValue = (value: unknown, path: string): unknown => {
    if (!isRecord(value)) return undefined

    if (Object.prototype.hasOwnProperty.call(value, path)) {
        return value[path]
    }

    return path
        .split(".")
        .filter(Boolean)
        .reduce<unknown>((current, segment) => {
            if (!isRecord(current)) return undefined
            return current[segment]
        }, value)
}

const getStepInputs = (step: unknown): Record<string, unknown> | null => {
    if (!isRecord(step)) return null

    const candidates = [
        step.inputs,
        step.input,
        isRecord(step.data) ? step.data.inputs : undefined,
        isRecord(step.data) ? step.data.input : undefined,
        isRecord(step.trace) ? getPathValue(step.trace, "data.inputs") : undefined,
        isRecord(step.trace)
            ? getPathValue(step.trace, "data.attributes.ag.data.inputs")
            : undefined,
    ]

    return candidates.find(isRecord) ?? null
}

const getStepKey = (step: unknown): string | undefined => {
    if (!isRecord(step)) return undefined
    const key = step.stepKey ?? step.step_key ?? step.key
    return typeof key === "string" && key.length ? key : undefined
}

const getStepTraceId = (step: unknown): string | undefined => {
    if (!isRecord(step)) return undefined
    const traceId =
        step.traceId ??
        step.trace_id ??
        getPathValue(step.trace, "tree.id") ??
        getPathValue(step.trace, "trees.0.tree.id")
    return typeof traceId === "string" && traceId.length ? traceId : undefined
}

const getStepOutputs = (step: unknown): Record<string, unknown> | null => {
    if (!isRecord(step)) return null

    const candidates = [
        step.outputs,
        step.output,
        isRecord(step.data) ? step.data.outputs : undefined,
        isRecord(step.data) ? step.data.output : undefined,
        isRecord(step.result) ? step.result.outputs : undefined,
        isRecord(step.result) ? step.result.output : undefined,
        isRecord(step.trace) ? getPathValue(step.trace, "data.outputs") : undefined,
        isRecord(step.trace)
            ? getPathValue(step.trace, "data.attributes.ag.data.outputs")
            : undefined,
    ]

    return candidates.find(isRecord) ?? null
}

export function extractEmbeddedInputValue(
    steps: unknown[],
    columns: EvaluationTableColumn[],
): Record<string, unknown> {
    const source = steps.map(getStepInputs).find(Boolean) ?? {}
    const editorColumns = mapEvalInputColumns(columns)

    if (!editorColumns.length) {
        return {...source}
    }

    return editorColumns.reduce<Record<string, unknown>>((acc, column) => {
        const value = getPathValue(source, column.key)
        if (value !== undefined) {
            acc[column.key] = value
        }
        return acc
    }, {})
}

const extractOutputValue = (
    steps: unknown[],
    columns: EvaluationTableColumn[],
): {value: Record<string, unknown>; stepKey?: string; traceId?: string} => {
    const firstStepKey = columns.find((column) => column.stepKey)?.stepKey
    const step =
        steps.find((candidate) => firstStepKey && getStepKey(candidate) === firstStepKey) ??
        steps.find((candidate) => getStepOutputs(candidate))
    const source = getStepOutputs(step) ?? {}
    const editorColumns = mapEvalInputColumns(columns)

    if (!editorColumns.length) {
        return {
            value: {...source},
            stepKey: getStepKey(step),
            traceId: getStepTraceId(step),
        }
    }

    return {
        value: editorColumns.reduce<Record<string, unknown>>((acc, column) => {
            const value = getPathValue(source, column.key)
            if (value !== undefined) {
                acc[column.key] = value
            }
            return acc
        }, {}),
        stepKey: getStepKey(step),
        traceId: getStepTraceId(step),
    }
}

export function mapEvalOutputSections({
    groups,
    columns,
    steps,
}: {
    groups: EvaluationTableColumnGroup[]
    columns: EvaluationTableColumn[]
    steps: unknown[]
}): EvalDrawerOutputSection[] {
    const columnMap = new Map(columns.map((column) => [column.id, column]))

    return groups
        .filter((group) => group.kind === "invocation")
        .map((group) => {
            const groupColumns = group.columnIds
                .map((columnId) => columnMap.get(columnId))
                .filter((column): column is EvaluationTableColumn => Boolean(column))
            const output = extractOutputValue(steps, groupColumns)

            return {
                id: group.id,
                label: "Outputs",
                stepKey: output.stepKey,
                traceId: output.traceId,
                columns: groupColumns,
            }
        })
        .filter((section) => section.columns.length)
}

const buildStaticMetricColumn = (
    groupId: string,
    definition: NonNullable<EvaluationTableColumnGroup["staticMetricColumns"]>[number],
): EvaluationTableColumn => {
    const pathSegments = definition.path.split(".").filter(Boolean)
    const valueKey = pathSegments[pathSegments.length - 1] ?? definition.path

    return {
        id: `${groupId}:${definition.path}`,
        label: definition.name,
        displayLabel: definition.displayLabel ?? definition.name,
        kind: "metric",
        stepKey: definition.stepKey,
        path: definition.path,
        pathSegments,
        stepType: "metric",
        valueKey,
        metricKey: definition.path,
        metricType: definition.metricType,
        groupId,
        __source: "runMetric",
    } as EvaluationTableColumn & {__source: "runMetric"}
}

export function mapEvalMetricSections({
    groups,
    columns,
}: {
    groups: EvaluationTableColumnGroup[]
    columns: EvaluationTableColumn[]
}): EvalDrawerMetricSection[] {
    const columnMap = new Map(columns.map((column) => [column.id, column]))
    const seenStaticMetricSignatures = new Set<string>()

    return groups
        .filter((group) => group.kind === "annotation" || group.kind === "metric")
        .map((group) => {
            const dynamicColumns = group.columnIds
                .map((columnId) => columnMap.get(columnId))
                .filter((column): column is EvaluationTableColumn => Boolean(column))
            const staticColumns =
                group.staticMetricColumns?.map((definition) =>
                    buildStaticMetricColumn(group.id, definition),
                ) ?? []

            return {
                id: group.id,
                label: group.label,
                columns: [...dynamicColumns, ...staticColumns],
            }
        })
        .filter((section) => {
            if (!section.columns.length) return false

            const hasOnlyStaticMetrics = section.columns.every(
                (column) => column.kind === "metric" && column.stepType === "metric",
            )
            if (!hasOnlyStaticMetrics) return true

            const signature = section.columns
                .map(
                    (column) =>
                        `${column.path}|${column.metricKey ?? ""}|${column.stepKey ?? ""}|${column.metricType ?? ""}`,
                )
                .sort()
                .join("::")

            if (seenStaticMetricSignatures.has(signature)) return false
            seenStaticMetricSignatures.add(signature)
            return true
        })
}
