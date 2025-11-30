import type {
    EvaluationColumnKind,
    EvaluationTableColumn,
    EvaluationTableColumnGroup,
    EvaluationTableColumnsResult,
} from "../atoms/table"
import {GeneralAutoEvalMetricColumns, GeneralHumanEvalMetricColumns} from "../constants/table"

const SKELETON_COLUMNS_PER_GROUP = 2

const createMetaSkeletonColumns = (): EvaluationTableColumn[] => [
    {
        id: "skeleton:meta:scenario-index-status",
        label: "#",
        displayLabel: "#",
        kind: "meta" as EvaluationColumnKind,
        path: "scenarioIndex",
        pathSegments: ["scenarioIndex"],
        stepType: "meta",
        order: 0,
        width: 72,
        minWidth: 72,
        sticky: "left",
        visibleFor: ["auto", "human"],
        metaRole: "scenarioIndexStatus",
        isSortable: false,
    },
]

const createSkeletonGroupColumns = (
    groupId: string,
    label: string,
    kind: EvaluationTableColumnGroup["kind"],
    columnKind: EvaluationColumnKind,
    stepType: EvaluationTableColumn["stepType"],
    startOrder: number,
): {columns: EvaluationTableColumn[]; group: EvaluationTableColumnGroup} => {
    const columns: EvaluationTableColumn[] = []
    for (let index = 0; index < SKELETON_COLUMNS_PER_GROUP; index += 1) {
        const order = startOrder + index
        columns.push({
            id: `skeleton:${groupId}:${index}`,
            label: `${label} ${index + 1}`,
            displayLabel: `${label} ${index + 1}`,
            kind: columnKind,
            path: `${groupId}.${index}`,
            pathSegments: [groupId, `${index}`],
            stepType,
            order,
            width: stepType === "input" || stepType === "invocation" ? 320 : 200,
            minWidth: stepType === "input" || stepType === "invocation" ? 200 : 160,
            groupId,
        })
    }

    return {
        columns,
        group: {
            id: groupId,
            label,
            kind,
            columnIds: columns.map((column) => column.id),
            order: startOrder,
        },
    }
}

export const buildSkeletonColumnResult = (
    evaluationType: "auto" | "human",
): EvaluationTableColumnsResult => {
    const metaColumns = createMetaSkeletonColumns()

    const inputGroup = createSkeletonGroupColumns(
        "inputs",
        "Inputs",
        "input",
        "testset",
        "input",
        100,
    )
    const outputGroup = createSkeletonGroupColumns(
        "outputs",
        "Model Outputs",
        "invocation",
        "invocation",
        200,
    )

    const allColumns = [...metaColumns, ...inputGroup.columns, ...outputGroup.columns]

    const groups: EvaluationTableColumnGroup[] = [inputGroup.group, outputGroup.group]

    const metricGroupId = evaluationType === "auto" ? "metrics:auto" : "metrics:human"
    const metricLabel = evaluationType === "auto" ? "Metrics (Auto)" : "Metrics (Human)"
    groups.push({
        id: metricGroupId,
        label: metricLabel,
        kind: "metric",
        columnIds: [],
        order: 300,
    })

    return {
        columns: allColumns,
        groups,
        staticMetricColumns: {
            auto: GeneralAutoEvalMetricColumns,
            human: GeneralHumanEvalMetricColumns,
        },
        evaluators: [],
        ungroupedColumns: metaColumns,
    }
}
