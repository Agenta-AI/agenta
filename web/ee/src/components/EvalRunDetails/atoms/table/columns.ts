import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    GeneralAutoEvalMetricColumns,
    GeneralHumanEvalMetricColumns,
} from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/assets/constants"

import {evaluationEvaluatorsByRunQueryAtomFamily} from "./evaluators"
import {evaluationRunQueryAtomFamily} from "./run"
import type {
    EvaluationColumnKind,
    EvaluationTableColumn,
    EvaluationTableColumnGroup,
    EvaluationTableColumnsResult,
    EvaluatorDefinition,
} from "./types"

interface RawMapping {
    step?: {
        key?: unknown
        path?: unknown
    }
    column?: {
        kind?: unknown
        name?: unknown
    }
}

const isMappingPayload = (
    mapping: RawMapping,
): mapping is {
    step: {
        key: string
        path: string
    }
    column: {
        kind: EvaluationColumnKind
        name: string
    }
} => {
    const stepKey = typeof mapping?.step?.key === "string"
    const stepPath = typeof mapping?.step?.path === "string"
    const columnName = typeof mapping?.column?.name === "string"
    const columnKind =
        mapping?.column?.kind === "testset" ||
        mapping?.column?.kind === "invocation" ||
        mapping?.column?.kind === "annotation" ||
        mapping?.column?.kind === "evaluator"

    return Boolean(stepKey && stepPath && columnName && columnKind)
}

const titleize = (value: string) =>
    value
        .replace(/[_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())

const splitPath = (path: string) => path.split(".").filter(Boolean)

const METRIC_TYPE_FALLBACK = "string"

const createMetaColumns = (): EvaluationTableColumn[] => [
    {
        id: "meta:scenario-index",
        label: "#",
        displayLabel: "#",
        kind: "meta",
        path: "scenarioIndex",
        pathSegments: ["scenarioIndex"],
        stepType: "meta",
        order: 0,
        width: 56,
        minWidth: 56,
        sticky: "left",
        visibleFor: ["auto", "human"],
        metaRole: "scenarioIndex",
        isSortable: false,
    },
    {
        id: "meta:status",
        label: "Status",
        displayLabel: "Status",
        kind: "meta",
        path: "status",
        pathSegments: ["status"],
        stepType: "meta",
        order: 1,
        width: 120,
        minWidth: 120,
        visibleFor: ["auto", "human"],
        metaRole: "status",
        isSortable: false,
    },
    {
        id: "meta:action",
        label: "Actions",
        displayLabel: "Actions",
        kind: "meta",
        path: "action",
        pathSegments: ["action"],
        stepType: "meta",
        order: 10_000,
        width: 140,
        minWidth: 140,
        sticky: "right",
        visibleFor: ["human"],
        metaRole: "action",
        isSortable: false,
    },
]

const widthByStepType: Record<string, number> = {
    input: 400,
    invocation: 400,
    annotation: 160,
}

const buildDefaultResult = (
    metaColumns: EvaluationTableColumn[],
): EvaluationTableColumnsResult => ({
    columns: metaColumns,
    groups: [],
    staticMetricColumns: {
        auto: GeneralAutoEvalMetricColumns,
        human: GeneralHumanEvalMetricColumns,
    },
    evaluators: [],
    ungroupedColumns: metaColumns,
})

const tableColumnsBaseAtomFamily = atomFamily((runId: string | null) =>
    atom((get) => {
        const metaColumns = createMetaColumns()
        if (!runId) {
            return buildDefaultResult(metaColumns)
        }

        const runQuery = get(evaluationRunQueryAtomFamily(runId))
        const runData = runQuery.data
        if (!runData) {
            return buildDefaultResult(metaColumns)
        }

        const evaluatorQuery = get(evaluationEvaluatorsByRunQueryAtomFamily(runId))
        const evaluators = evaluatorQuery?.data ?? []

        const mappings = Array.isArray(runData.camelRun?.data?.mappings)
            ? runData.camelRun.data.mappings
            : []

        const counters: Record<"input" | "invocation" | "annotation", number> = {
            input: 0,
            invocation: 0,
            annotation: 0,
        }

        const dynamicColumns: EvaluationTableColumn[] = mappings
            .filter(isMappingPayload)
            .filter((mapping) => !mapping.column.name.includes("_dedup_id"))
            .map((mapping) => {
                const stepMeta = runData.runIndex.steps[mapping.step.key]
                const stepType = stepMeta?.kind ?? "annotation"
                const pathSegments = splitPath(mapping.step.path)
                const valueKey = pathSegments[pathSegments.length - 1] ?? mapping.column.name
                const orderBase = stepType === "input" ? 100 : stepType === "invocation" ? 200 : 300
                const order = (orderBase + counters[stepType as keyof typeof counters]++) as number
                const columnId = `${mapping.column.kind}:${mapping.column.name}:${order}`
                const width = widthByStepType[stepType] ?? undefined
                const evaluatorRef = stepMeta?.refs?.evaluator

                return {
                    id: columnId,
                    label: mapping.column.name,
                    displayLabel: titleize(mapping.column.name),
                    kind: mapping.column.kind as EvaluationColumnKind,
                    stepKey: mapping.step.key,
                    path: mapping.step.path,
                    pathSegments,
                    stepType,
                    valueKey,
                    metricKey: stepType === "annotation" ? valueKey : undefined,
                    evaluatorId: evaluatorRef?.id,
                    evaluatorSlug: evaluatorRef?.slug,
                    order,
                    width,
                    minWidth: width,
                    groupId:
                        stepType === "input"
                            ? "inputs"
                            : stepType === "invocation"
                              ? "outputs"
                              : stepType === "annotation"
                                ? evaluatorRef?.id
                                    ? `annotation:${evaluatorRef.id}`
                                    : "annotations"
                                : undefined,
                }
            })

        const evaluatorById = new Map(evaluators.map((definition) => [definition.id, definition]))

        const annotationGroups = new Map<
            string,
            {label: string; columns: EvaluationTableColumn[]}
        >()

        const enrichedDynamicColumns = dynamicColumns.map((column) => {
            if (column.stepType !== "annotation") {
                return column
            }

            const evaluator = column.evaluatorId ? evaluatorById.get(column.evaluatorId) : undefined
            const metricKey = column.metricKey || column.valueKey
            const metricDefinition = evaluator?.metrics.find(
                (metric) => metric.name === metricKey || metric.path === metricKey,
            )
            const metricType =
                metricDefinition?.metricType || column.metricType || METRIC_TYPE_FALLBACK
            const evaluatorLabel = evaluator?.name || column.evaluatorSlug || "Annotations"
            const groupKey = column.evaluatorId ? `annotation:${column.evaluatorId}` : "annotations"

            const groupLabel = titleize(String(evaluatorLabel))
            if (!annotationGroups.has(groupKey)) {
                annotationGroups.set(groupKey, {label: groupLabel, columns: []})
            }

            const enrichedColumn: EvaluationTableColumn = {
                ...column,
                metricKey,
                metricType,
                evaluatorName: evaluator?.name,
                displayLabel: metricDefinition?.displayLabel || column.displayLabel || column.label,
                description: metricDefinition?.description || column.description,
                groupId: groupKey,
            }

            annotationGroups.get(groupKey)?.columns.push(enrichedColumn)
            return enrichedColumn
        })

        const combinedColumns = [...metaColumns, ...enrichedDynamicColumns]

        const groups: EvaluationTableColumnGroup[] = []
        const pushGroup = (
            id: string,
            label: string,
            kind: EvaluationTableColumnGroup["kind"],
            columns: EvaluationTableColumn[],
            order: number,
            extra?: Partial<EvaluationTableColumnGroup>,
        ) => {
            if (!columns.length) return
            groups.push({
                id,
                label,
                kind,
                columnIds: columns.map((column) => column.id),
                order,
                ...extra,
            })
        }

        pushGroup(
            "inputs",
            "Inputs",
            "input",
            enrichedDynamicColumns.filter((column) => column.stepType === "input"),
            100,
        )

        pushGroup(
            "outputs",
            "Model Outputs",
            "invocation",
            enrichedDynamicColumns.filter((column) => column.stepType === "invocation"),
            200,
        )

        let annotationOrder = 300
        annotationGroups.forEach((group, key) => {
            pushGroup(key, group.label, "annotation", group.columns, annotationOrder)
            annotationOrder += 1
        })

        if (GeneralAutoEvalMetricColumns.length) {
            groups.push({
                id: "metrics:auto",
                label: "Metrics",
                // label: "Metrics (Auto)",
                kind: "metric",
                columnIds: [],
                order: annotationOrder,
                staticMetricColumns: GeneralAutoEvalMetricColumns,
            })
            annotationOrder += 1
        }

        if (GeneralHumanEvalMetricColumns.length) {
            groups.push({
                id: "metrics:human",
                label: "Metrics (Human)",
                kind: "metric",
                columnIds: [],
                order: annotationOrder,
                staticMetricColumns: GeneralHumanEvalMetricColumns,
            })
            annotationOrder += 1
        }

        groups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

        const sortedColumns = [...combinedColumns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

        const groupedIds = new Set<string>()
        groups.forEach((group) => group.columnIds.forEach((id) => groupedIds.add(id)))
        const ungroupedColumns = sortedColumns.filter((column) => !groupedIds.has(column.id))

        return {
            columns: sortedColumns,
            groups,
            staticMetricColumns: {
                auto: GeneralAutoEvalMetricColumns,
                human: GeneralHumanEvalMetricColumns,
            },
            evaluators,
            ungroupedColumns,
        }
    }),
)

export const tableColumnsAtomFamily = atomFamily((runId: string | null) =>
    atom((get) => get(tableColumnsBaseAtomFamily(runId))),
)
