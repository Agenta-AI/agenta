import {useMemo} from "react"

import type {RootDrawerViewMode, TestcaseDataEditorColumn} from "@agenta/entity-ui/testcase"
import {formatMetricDisplay} from "@agenta/ui/cell-renderers"
import {atom, useAtomValue} from "jotai"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/Evaluations/atoms/runMetrics"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

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
    rootViewMode?: RootDrawerViewMode
    collapseSignal?: number
}

interface EvaluatorMetricsAdapterProps {
    runId: string
    scenarioId: string
    sections: EvalDrawerMetricSection[]
    rootViewMode?: RootDrawerViewMode
    collapseSignal?: number
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

function useMetricValueSectionData({
    runId,
    scenarioId,
    sections,
}: Pick<ValueSectionProps, "runId" | "scenarioId" | "sections">) {
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

    return {columns: editorColumns, value}
}

export function useEvaluatorMetricDrawerData({
    runId,
    scenarioId,
    sections,
}: Pick<EvaluatorMetricsAdapterProps, "runId" | "scenarioId" | "sections">) {
    const evaluatorSections = useMemo(
        () => sections.filter((section) => section.kind === "annotation"),
        [sections],
    )
    const metricSections = useMemo(
        () => sections.filter((section) => section.kind === "metric"),
        [sections],
    )
    const evaluators = useMetricValueSectionData({
        runId,
        scenarioId,
        sections: evaluatorSections,
    })
    const metrics = useMetricValueSectionData({
        runId,
        scenarioId,
        sections: metricSections,
    })

    return {evaluators, metrics}
}

const ValueSection = ({
    title,
    runId,
    scenarioId,
    sections,
    rootViewMode,
    collapseSignal,
}: ValueSectionProps) => {
    const {columns, value} = useMetricValueSectionData({runId, scenarioId, sections})

    if (!columns.length) return null

    return (
        <EvalDrawerDataSection
            title={title}
            value={value}
            columns={columns}
            rootViewMode={rootViewMode}
            collapseSignal={collapseSignal}
        />
    )
}

interface EvaluatorSectionProps {
    runId: string
    scenarioId: string
    section: EvalDrawerMetricSection
    rootViewMode?: RootDrawerViewMode
    collapseSignal?: number
}

/**
 * Renders a single annotation/evaluator section with its own trace info.
 * Each evaluator has its own annotation trace (separate from the invocation
 * trace), so they are rendered as individual sections rather than flattened.
 */
const EvaluatorSection = ({
    runId,
    scenarioId,
    section,
    rootViewMode,
    collapseSignal,
}: EvaluatorSectionProps) => {
    const evaluatorSections = useMemo(() => [section], [section])
    const {columns, value} = useMetricValueSectionData({
        runId,
        scenarioId,
        sections: evaluatorSections,
    })

    if (!columns.length) return null

    return (
        <EvalDrawerDataSection
            title={section.label}
            value={value}
            columns={columns}
            rootViewMode={rootViewMode}
            collapseSignal={collapseSignal}
            headerExtra={
                section.traceId ? (
                    <SharedGenerationResultUtils
                        traceId={section.traceId}
                        showStatus={false}
                        className="flex items-center gap-1"
                    />
                ) : null
            }
        />
    )
}

const EvaluatorMetricsAdapter = ({
    runId,
    scenarioId,
    sections,
    rootViewMode,
    collapseSignal,
}: EvaluatorMetricsAdapterProps) => {
    const evaluatorSections = useMemo(
        () => sections.filter((section) => section.kind === "annotation"),
        [sections],
    )
    const metricSections = useMemo(
        () => sections.filter((section) => section.kind === "metric"),
        [sections],
    )

    if (!evaluatorSections.length && !metricSections.length) return null

    return (
        <div className="flex flex-col">
            {evaluatorSections.map((section) => (
                <EvaluatorSection
                    key={section.id}
                    runId={runId}
                    scenarioId={scenarioId}
                    section={section}
                    rootViewMode={rootViewMode}
                    collapseSignal={collapseSignal}
                />
            ))}
            <ValueSection
                title="Metrics"
                runId={runId}
                scenarioId={scenarioId}
                sections={metricSections}
                rootViewMode={rootViewMode}
                collapseSignal={collapseSignal}
            />
        </div>
    )
}

export default EvaluatorMetricsAdapter
