import {memo, useCallback, useMemo} from "react"
import {isValidElement} from "react"

import {Skeleton, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/evaluations/atoms/runMetrics"
import MetricDetailsPreviewPopover from "@/oss/components/evaluations/components/MetricDetailsPreviewPopover"
import GenericDrawer from "@/oss/components/GenericDrawer"

import ReadOnlyBox from "../../pages/evaluations/onlineEvaluation/components/ReadOnlyBox"
import {runInvocationRefsAtomFamily, runTestsetIdsAtomFamily} from "../atoms/runDerived"
import type {
    ColumnValueDescriptor,
    EvaluationTableColumn,
    MetricColumnDefinition,
} from "../atoms/table"
import {
    columnValueDescriptorMapAtomFamily,
    createColumnValueDescriptor,
} from "../atoms/table/columnAccess"
import {evaluationRunIndexAtomFamily} from "../atoms/table/run"
import usePreviewTableData from "../hooks/usePreviewTableData"
import useScenarioCellValue from "../hooks/useScenarioCellValue"
import {useScenarioStepValue} from "../hooks/useScenarioStepValue"
import {
    closeFocusDrawerAtom,
    focusScenarioAtom,
    isFocusDrawerOpenAtom,
    resetFocusDrawerAtom,
} from "../state/focusDrawerAtom"
import {clearFocusDrawerQueryParams} from "../state/urlFocusDrawer"
import {formatMetricDisplay, METRIC_EMPTY_PLACEHOLDER} from "../utils/metricFormatter"

import FocusDrawerHeader from "./FocusDrawerHeader"
import FocusDrawerSidePanel from "./FocusDrawerSidePanel"
import {VariantReferenceChip, TestsetChipList} from "./reference"

const SECTION_CARD_CLASS = "rounded-xl border border-[#EAECF0] bg-white"

const toSectionAnchorId = (value: string) =>
    `focus-section-${value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`

const buildStaticMetricColumn = (
    groupId: string,
    definition: MetricColumnDefinition,
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
        __source: "runMetric",
    } as EvaluationTableColumn & {__source: "runMetric"}
}

const {Text, Title} = Typography

type FocusDrawerColumn = EvaluationTableColumn & {__source?: "runMetric"}

const isRunMetricColumn = (
    column: EvaluationTableColumn,
): column is FocusDrawerColumn & {__source: "runMetric"} =>
    (column as FocusDrawerColumn).__source === "runMetric"

const resolveRunMetricScalar = (stats: any): unknown => {
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
        return stats
    }

    const candidates = [
        stats.value,
        stats.total,
        stats.sum,
        stats.mean,
        stats.avg,
        stats.average,
        stats.median,
        stats.max,
        stats.min,
    ]

    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null) return candidate
    }

    if (Array.isArray(stats.frequency) && stats.frequency.length) {
        const [first] = [...stats.frequency].sort(
            (a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0),
        )
        if (first?.value !== undefined) return first.value
    }

    if (Array.isArray(stats.unique) && stats.unique.length) {
        return stats.unique[0]
    }

    return undefined
}

interface FocusDrawerContentProps {
    runId: string
    scenarioId: string
}

interface SectionColumnEntry {
    column: EvaluationTableColumn
    descriptor: ColumnValueDescriptor
}

interface FocusDrawerSection {
    id: string
    label: string
    columns: SectionColumnEntry[]
    anchorId: string
}

const RunMetricValue = memo(
    ({
        runId,
        scenarioId,
        column,
        descriptor,
    }: {
        runId: string
        scenarioId: string
        column: FocusDrawerColumn & {__source: "runMetric"}
        descriptor: ColumnValueDescriptor
    }) => {
        const {selection: scenarioMetric, showSkeleton} = useScenarioCellValue({
            runId,
            scenarioId,
            column,
            disableVisibilityTracking: true,
        })

        const runSelectionAtom = useMemo(
            () =>
                previewRunMetricStatsSelectorFamily({
                    runId,
                    metricKey: descriptor.metricKey,
                    metricPath: descriptor.path,
                    stepKey: descriptor.stepKey,
                }),
            [runId, descriptor.metricKey, descriptor.path, descriptor.stepKey],
        )
        const runSelection = useAtomValue(runSelectionAtom)
        const runStats = runSelection.state === "hasData" ? runSelection.stats : undefined
        const runScalar = useMemo(() => resolveRunMetricScalar(runStats), [runStats])

        const scenarioHasValue =
            scenarioMetric.value !== undefined &&
            scenarioMetric.value !== null &&
            !scenarioMetric.isLoading

        const valueToFormat = scenarioHasValue ? scenarioMetric.value : runScalar
        const resolvedValue = scenarioHasValue ? scenarioMetric.value : (runStats ?? runScalar)

        const formattedValue =
            valueToFormat === undefined || valueToFormat === null
                ? METRIC_EMPTY_PLACEHOLDER
                : formatMetricDisplay({
                      value: valueToFormat,
                      metricKey: descriptor.metricKey ?? descriptor.valueKey ?? descriptor.path,
                      metricType: descriptor.metricType,
                  })

        const isPlaceholder = formattedValue === METRIC_EMPTY_PLACEHOLDER
        const isLoading =
            (showSkeleton || scenarioMetric.isLoading) &&
            !scenarioHasValue &&
            runSelection.state === "loading" &&
            runScalar === undefined

        return (
            <div className="flex flex-col gap-1">
                <Text strong>{column.displayLabel ?? column.label ?? column.id}</Text>
                <ReadOnlyBox>
                    {isLoading ? (
                        <Skeleton active paragraph={{rows: 1}} />
                    ) : (
                        <MetricDetailsPreviewPopover
                            runId={runId}
                            metricKey={
                                descriptor.metricKey ?? descriptor.valueKey ?? descriptor.path
                            }
                            metricPath={descriptor.path}
                            metricLabel={column.displayLabel ?? column.label}
                            stepKey={descriptor.stepKey}
                            highlightValue={resolvedValue}
                            fallbackValue={resolvedValue}
                            stepType={descriptor.stepType}
                        >
                            <span
                                className={`${
                                    isPlaceholder ? "text-neutral-500" : "text-neutral-900"
                                }`}
                            >
                                {formattedValue}
                            </span>
                        </MetricDetailsPreviewPopover>
                    )}
                </ReadOnlyBox>
            </div>
        )
    },
)

RunMetricValue.displayName = "RunMetricValue"

const ScenarioColumnValue = memo(
    ({
        runId,
        scenarioId,
        column,
        descriptor,
    }: {
        runId: string
        scenarioId: string
        column: EvaluationTableColumn
        descriptor: ColumnValueDescriptor
    }) => {
        const displayLabel = column.displayLabel ?? column.label ?? column.id
        const isMetric = column.kind === "metric"

        if (isMetric) {
            if (isRunMetricColumn(column)) {
                return (
                    <RunMetricValue
                        runId={runId}
                        scenarioId={scenarioId}
                        column={column}
                        descriptor={descriptor}
                    />
                )
            }

            const {selection, showSkeleton} = useScenarioCellValue({
                runId,
                scenarioId,
                column,
                disableVisibilityTracking: true,
            })
            const {value, displayValue, isLoading} = selection

            const formattedValue =
                displayValue ??
                formatMetricDisplay({
                    value,
                    metricKey: descriptor.metricKey ?? descriptor.valueKey ?? descriptor.path,
                    metricType: descriptor.metricType,
                })

            const isPlaceholder = formattedValue === METRIC_EMPTY_PLACEHOLDER

            return (
                <div className="flex flex-col gap-1">
                    <Text strong>{displayLabel}</Text>
                    <ReadOnlyBox>
                        {showSkeleton ? (
                            <Skeleton active paragraph={{rows: 1}} />
                        ) : (
                            <MetricDetailsPreviewPopover
                                runId={runId}
                                metricKey={
                                    descriptor.metricKey ?? descriptor.valueKey ?? descriptor.path
                                }
                                metricPath={descriptor.path}
                                metricLabel={displayLabel}
                                stepKey={descriptor.stepKey}
                                highlightValue={value}
                                fallbackValue={value ?? displayValue ?? formattedValue}
                                stepType={descriptor.stepType}
                            >
                                <span
                                    className={`text-sm ${
                                        isPlaceholder ? "text-neutral-500" : "text-neutral-900"
                                    }`}
                                >
                                    {formattedValue}
                                </span>
                            </MetricDetailsPreviewPopover>
                        )}
                    </ReadOnlyBox>
                </div>
            )
        }

        const valueResult = useScenarioStepValue({scenarioId, runId, column})
        const resolvedValue = valueResult.displayValue ?? valueResult.value

        const renderValue = () => {
            if (valueResult.isLoading && resolvedValue === undefined) {
                return <Skeleton active paragraph={{rows: 1}} />
            }

            if (isValidElement(resolvedValue)) {
                return resolvedValue
            }

            if (resolvedValue === null || resolvedValue === undefined) {
                return <Text type="secondary">—</Text>
            }

            if (
                typeof resolvedValue === "string" ||
                typeof resolvedValue === "number" ||
                typeof resolvedValue === "boolean"
            ) {
                return <Text>{String(resolvedValue)}</Text>
            }

            try {
                return (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm text-[#1D2939]">
                        {JSON.stringify(resolvedValue, null, 2)}
                    </pre>
                )
            } catch {
                return <Text>{String(resolvedValue)}</Text>
            }
        }

        return (
            <div className="flex flex-col gap-1">
                <Text strong>{displayLabel}</Text>
                <ReadOnlyBox>{renderValue()}</ReadOnlyBox>
            </div>
        )
    },
)

ScenarioColumnValue.displayName = "ScenarioColumnValue"

const FocusDrawerContent = ({runId, scenarioId}: FocusDrawerContentProps) => {
    const {columnResult} = usePreviewTableData({runId})
    const descriptorMap = useAtomValue(
        useMemo(() => columnValueDescriptorMapAtomFamily(runId ?? null), [runId]),
    )
    const runIndex = useAtomValue(
        useMemo(() => evaluationRunIndexAtomFamily(runId ?? null), [runId]),
    )
    const invocationRefs = useAtomValue(
        useMemo(() => runInvocationRefsAtomFamily(runId ?? null), [runId]),
    )
    const testsetIds = useAtomValue(useMemo(() => runTestsetIdsAtomFamily(runId ?? null), [runId]))
    const variantId = useMemo(
        () => invocationRefs?.variantId ?? invocationRefs?.applicationVariantId ?? null,
        [invocationRefs],
    )

    if (!columnResult) {
        return <Skeleton active paragraph={{rows: 6}} />
    }

    const groups = columnResult.groups ?? []
    const columnMap = useMemo(() => {
        const map = new Map<string, EvaluationTableColumn>()
        columnResult.columns.forEach((column) => {
            map.set(column.id, column)
        })
        return map
    }, [columnResult.columns])

    const sections = useMemo<FocusDrawerSection[]>(() => {
        const resolveDescriptor = (column: EvaluationTableColumn) =>
            descriptorMap?.[column.id] ?? createColumnValueDescriptor(column, runIndex)

        return groups
            .map((group) => {
                if (group.kind === "metric" && group.id === "metrics:human") {
                    return null
                }

                const sectionLabel =
                    group.kind === "metric" && group.id === "metrics:auto" ? "Metrics" : group.label

                const dynamicColumns: SectionColumnEntry[] = group.columnIds
                    .map((columnId) => columnMap.get(columnId))
                    .filter((column): column is EvaluationTableColumn => Boolean(column))
                    .map((column) => ({
                        column,
                        descriptor: resolveDescriptor(column),
                    }))

                const staticColumns: SectionColumnEntry[] =
                    group.kind === "metric" && group.staticMetricColumns?.length
                        ? group.staticMetricColumns.map((definition) => {
                              const column = buildStaticMetricColumn(group.id, definition)
                              return {
                                  column,
                                  descriptor: resolveDescriptor(column),
                              }
                          })
                        : []

                const columns: SectionColumnEntry[] = [...dynamicColumns, ...staticColumns]

                if (!columns.length) {
                    return null
                }

                return {
                    id: group.id,
                    label: sectionLabel,
                    columns,
                    anchorId: toSectionAnchorId(group.id),
                }
            })
            .filter((section): section is FocusDrawerSection => Boolean(section))
    }, [columnMap, descriptorMap, groups, runIndex])

    return (
        <div
            className="flex h-full flex-col gap-4 overflow-auto bg-[#F8FAFC] p-4"
            data-focus-drawer-content
        >
            <div className="flex flex-wrap items-center gap-2">
                {variantId ? <VariantReferenceChip variantId={variantId} /> : null}
                <TestsetChipList ids={testsetIds ?? []} />
            </div>
            {sections.map((section) => (
                <section
                    key={section.id}
                    id={section.anchorId}
                    className={`${SECTION_CARD_CLASS} flex flex-col gap-3`}
                >
                    <div className="border-b border-[#EAECF0] px-4 py-3">
                        <Title level={5} className="!mb-0 text-[#1D2939]">
                            {section.label}
                        </Title>
                    </div>
                    <div className="flex flex-col gap-3 px-4 pb-4">
                        {section.columns.map(({column, descriptor}) => (
                            <ScenarioColumnValue
                                key={column.id}
                                runId={runId}
                                scenarioId={scenarioId}
                                column={column}
                                descriptor={descriptor}
                            />
                        ))}
                    </div>
                </section>
            ))}

            {/* {ungroupedColumns.length ? (
                <section
                    id={toSectionAnchorId("additional-details")}
                    className={`${SECTION_CARD_CLASS} flex flex-col gap-3`}
                >
                    <div className="border-b border-[#EAECF0] px-4 py-3">
                        <Title level={5} className="!mb-0 text-[#1D2939]">
                            Additional Details
                        </Title>
                    </div>
                    <div className="flex flex-col gap-3 px-4 pb-4">
                        {ungroupedColumns.map((column) => {
                            const descriptor =
                                descriptorMap?.[column.id] ??
                                createColumnValueDescriptor(column, runIndex)
                            return (
                                <ScenarioColumnValue
                                    key={column.id}
                                    runId={runId}
                                    scenarioId={scenarioId}
                                    column={column}
                                    descriptor={descriptor}
                                />
                            )
                        })}
                    </div>
                </section>
            ) : null} */}
        </div>
    )
}

const FocusDrawer = () => {
    const isOpen = useAtomValue(isFocusDrawerOpenAtom)
    const focus = useAtomValue(focusScenarioAtom)
    const closeDrawer = useSetAtom(closeFocusDrawerAtom)
    const resetDrawer = useSetAtom(resetFocusDrawerAtom)

    const focusRunId = focus?.focusRunId ?? null
    const focusScenarioId = focus?.focusScenarioId ?? null

    const handleClose = useCallback(() => {
        closeDrawer(null)
    }, [closeDrawer])

    const handleAfterOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                resetDrawer(null)
                clearFocusDrawerQueryParams()
            }
        },
        [resetDrawer],
    )

    const shouldRenderContent = Boolean(focusRunId && focusScenarioId)

    if (!focusRunId) {
        return null
    }

    return (
        <GenericDrawer
            open={isOpen}
            onClose={handleClose}
            afterOpenChange={handleAfterOpenChange}
            expandable
            closeOnLayoutClick={false}
            className="[&_.ant-drawer-body]:p-0 [&_.ant-drawer-body]:bg-[#F8FAFC]"
            sideContentDefaultSize={240}
            headerExtra={
                shouldRenderContent ? (
                    <FocusDrawerHeader runId={focusRunId} scenarioId={focusScenarioId} />
                ) : null
            }
            sideContent={
                shouldRenderContent && focusScenarioId ? (
                    <FocusDrawerSidePanel runId={focusRunId} scenarioId={focusScenarioId} />
                ) : null
            }
            mainContent={
                shouldRenderContent && focusScenarioId ? (
                    <FocusDrawerContent runId={focusRunId} scenarioId={focusScenarioId} />
                ) : (
                    <div className="p-6">
                        <Skeleton active paragraph={{rows: 6}} />
                    </div>
                )
            }
        />
    )
}

export default memo(FocusDrawer)
