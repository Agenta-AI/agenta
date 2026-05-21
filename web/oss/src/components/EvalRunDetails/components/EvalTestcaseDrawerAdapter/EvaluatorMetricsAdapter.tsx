import {useMemo} from "react"

import type {TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
import {formatMetricDisplay} from "@agenta/ui/cell-renderers"
import {atom, useAtomValue} from "jotai"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/Evaluations/atoms/runMetrics"

import {
    buildColumnValueConfig,
    scenarioColumnValueSelectionAtomFamily,
} from "../../atoms/scenarioColumnValues"
import type {EvaluationTableColumn} from "../../atoms/table"
import {
    isRunMetricColumn,
    resolveRunMetricScalar,
    stripGroupPrefix,
} from "../../utils/runMetricHelpers"

import EvalDrawerDataSection from "./EvalDrawerDataSection"
import type {EvalDrawerMetricSection} from "./model"

interface ValueSectionProps {
    title: string
    runId: string
    scenarioId: string
    sections: EvalDrawerMetricSection[]
}

interface EvaluatorMetricsAdapterProps {
    runId: string
    scenarioId: string
    sections: EvalDrawerMetricSection[]
}

const getEditorKey = (section: EvalDrawerMetricSection, column: EvaluationTableColumn) =>
    `${section.id}:${column.id}`

const getColumnLabel = (section: EvalDrawerMetricSection, column: EvaluationTableColumn) => {
    const rawLabel = column.displayLabel ?? column.label ?? column.id
    const strippedLabel = stripGroupPrefix(rawLabel, section.label)
    const keyLabel =
        column.valueKey ?? column.pathSegments?.[column.pathSegments.length - 1] ?? strippedLabel

    return section.kind === "annotation" ? `${section.label} (${keyLabel})` : strippedLabel
}

const toEditorColumn = (
    section: EvalDrawerMetricSection,
    column: EvaluationTableColumn,
): TestcaseDataEditorColumn => {
    const label = getColumnLabel(section, column)

    return {
        key: getEditorKey(section, column),
        label,
        name: label,
        pathMode: "direct",
    }
}

const formatDrawerValue = ({
    column,
    value,
    displayValue,
}: {
    column: EvaluationTableColumn
    value: unknown
    displayValue?: unknown
}): unknown => {
    const formatted =
        displayValue ??
        formatMetricDisplay({
            value,
            metricKey: column.metricKey ?? column.valueKey ?? column.path,
            metricType: column.metricType,
        })

    return typeof formatted === "boolean" ? String(formatted) : formatted
}

const ValueSection = ({title, runId, scenarioId, sections}: ValueSectionProps) => {
    const editorColumns = useMemo(
        () =>
            sections.flatMap((section) =>
                section.columns.map((column) => toEditorColumn(section, column)),
            ),
        [sections],
    )

    const valueAtom = useMemo(
        () =>
            atom((get) =>
                sections.reduce<Record<string, unknown>>((acc, section) => {
                    for (const column of section.columns) {
                        const editorKey = getEditorKey(section, column)
                        const selection = get(
                            scenarioColumnValueSelectionAtomFamily({
                                scenarioId,
                                runId,
                                column: buildColumnValueConfig(column, {enabled: true}),
                            }),
                        )

                        if (section.kind === "annotation" && selection.stepError) {
                            acc[editorKey] = selection.stepError.raw ?? selection.stepError.message
                            continue
                        }

                        if (isRunMetricColumn(column)) {
                            const runSelection = get(
                                previewRunMetricStatsSelectorFamily({
                                    runId,
                                    metricKey: column.metricKey ?? column.valueKey ?? column.path,
                                    metricPath: column.path,
                                    stepKey: column.stepKey,
                                }),
                            )
                            const runStats =
                                runSelection.state === "hasData" ? runSelection.stats : undefined
                            const runScalar = resolveRunMetricScalar(runStats)
                            const scenarioHasValue =
                                selection.value !== undefined &&
                                selection.value !== null &&
                                !selection.isLoading
                            const value = scenarioHasValue ? selection.value : runScalar

                            acc[editorKey] = formatDrawerValue({column, value})
                            continue
                        }

                        acc[editorKey] = formatDrawerValue({
                            column,
                            value: selection.value,
                            displayValue: selection.displayValue,
                        })
                    }
                    return acc
                }, {}),
            ),
        [runId, scenarioId, sections],
    )
    const value = useAtomValue(valueAtom)

    if (!editorColumns.length) return null

    return <EvalDrawerDataSection title={title} value={value} columns={editorColumns} />
}

const EvaluatorMetricsAdapter = ({runId, scenarioId, sections}: EvaluatorMetricsAdapterProps) => {
    const evaluatorSections = sections.filter((section) => section.kind === "annotation")
    const metricSections = sections.filter((section) => section.kind === "metric")

    if (!evaluatorSections.length && !metricSections.length) return null

    return (
        <div className="flex flex-col">
            <ValueSection
                title="Evaluators"
                runId={runId}
                scenarioId={scenarioId}
                sections={evaluatorSections}
            />
            <ValueSection
                title="Metrics"
                runId={runId}
                scenarioId={scenarioId}
                sections={metricSections}
            />
        </div>
    )
}

export default EvaluatorMetricsAdapter
