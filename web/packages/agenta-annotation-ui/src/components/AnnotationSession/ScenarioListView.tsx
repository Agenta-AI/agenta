/**
 * ScenarioListView
 *
 * Presentational list view for the annotation session using InfiniteVirtualTable.
 * Column definitions come from the session controller (`listColumnDefs`).
 * This component maps each `ScenarioListColumnDef` to the appropriate renderer.
 *
 * Follows the same IVT pattern used in AnnotationQueuesView and EvalRunDetails.
 */

import {memo, useCallback, useMemo, useState} from "react"

import {annotationSessionController, OUTPUT_KEYS} from "@agenta/annotation"
import type {AnnotationColumnDef, ScenarioListColumnDef, SessionView} from "@agenta/annotation"
import {
    traceEntityAtomFamily,
    traceRootSpanAtomFamily,
    traceInputsAtomFamily,
    traceOutputsAtomFamily,
} from "@agenta/entities/trace"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    SmartCellContent,
    MetricCellContent,
    MetricValueDisplay,
    hasDistributionData,
    extractBasicStats,
} from "@agenta/ui/cell-renderers"
import {
    InfiniteVirtualTableFeatureShell,
    createActionsColumn,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {ArrowSquareOut, CaretDown, CaretRight, Check, NotePencil, Eye} from "@phosphor-icons/react"
import {Button, Drawer, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {useAnnotationNavigation, useMetricPopoverWrapper} from "../../context/AnnotationUIContext"
import ScenarioContent from "../ScenarioContent"

/** Only binary and categorical metric types should render distribution bars */
const isDistributionType = (stats: Record<string, unknown> | undefined): boolean => {
    if (!stats) return false
    const type = stats.type
    if (typeof type !== "string") return false
    return type === "binary" || type.startsWith("categorical")
}

import AnnotationPanel from "./AnnotationPanel"

// ============================================================================
// TESTCASE CELL RENDERERS
// ============================================================================

/**
 * Renders a testcase data field value for a scenario row.
 * Fetches testcase data via scenarioTestcaseRef → testcaseData.
 */
const TestcaseDataCell = memo(function TestcaseDataCell({
    scenarioId,
    dataKey,
    chatPreference,
}: {
    scenarioId: string
    dataKey: string
    chatPreference?: "input" | "output"
}) {
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const testcaseQuery = useAtomValue(
        annotationSessionController.selectors.testcaseData(testcaseRef.testcaseId || ""),
    )
    const testcase = testcaseQuery?.data

    if (!testcaseRef.testcaseId || testcaseQuery?.isPending) {
        return <Typography.Text type="secondary">...</Typography.Text>
    }

    const value = testcase?.data?.[dataKey] ?? null

    if (value === null || value === undefined) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    return (
        <SmartCellContent
            value={value}
            keyPrefix={`tc-${dataKey}-${scenarioId}`}
            maxLines={3}
            chatPreference={chatPreference}
        />
    )
})

// ============================================================================
// TYPES
// ============================================================================

type ScenarioRecord = Record<string, unknown>

interface ScenarioListViewProps {
    queueId: string
    onSaved: () => void
    onCompleted: (scenarioId: string) => void
    onViewChange?: (view: SessionView) => void
}

/** Row shape for the IVT. Extends scenario data with table-required fields. */
interface ScenarioTableRow {
    key: string
    __isSkeleton?: boolean
    scenarioIndex: number
    scenarioId: string
    status: string | null
    raw: ScenarioRecord
    [key: string]: unknown
}

// ============================================================================
// STATUS HELPERS
// ============================================================================

const STATUS_TAG_MAP: Record<string, {color: string; label: string}> = {
    success: {color: "green", label: "Success"},
    pending: {color: "orange", label: "Pending"},
    running: {color: "blue", label: "Running"},
    queued: {color: "orange", label: "Queued"},
    failed: {color: "red", label: "Failed"},
    error: {color: "red", label: "Error"},
}

const DEFAULT_STATUS_TAG = {color: "default", label: "Pending"}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extract trace_id from scenario record directly.
 * Scenarios from trace-based queues often store trace_id in tags or meta.
 */
function extractTraceIdFromScenario(scenario: ScenarioRecord): string {
    const tags = scenario.tags as Record<string, unknown> | null | undefined
    if (tags?.trace_id && typeof tags.trace_id === "string") return tags.trace_id

    const meta = scenario.meta as Record<string, unknown> | null | undefined
    if (meta?.trace_id && typeof meta.trace_id === "string") return meta.trace_id

    return ""
}

// ============================================================================
// TRACE CELL RENDERERS
// ============================================================================

const TraceInputKeyCell = memo(function TraceInputKeyCell({
    scenarioId,
    scenario,
    inputKey,
}: {
    scenarioId: string
    scenario: ScenarioRecord
    inputKey: string
}) {
    const directTraceId = extractTraceIdFromScenario(scenario)
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const effectiveTraceId = directTraceId || traceRef.traceId || ""

    const inputs = useAtomValue(traceInputsAtomFamily(effectiveTraceId || null))
    const value = inputs?.[inputKey] ?? null

    if (!effectiveTraceId || value === null || value === undefined) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    return (
        <SmartCellContent
            value={value}
            keyPrefix={`trace-input-${inputKey}-${scenarioId}`}
            maxLines={3}
            chatPreference="input"
        />
    )
})

const TraceInputCell = memo(function TraceInputCell({
    scenarioId,
    scenario,
}: {
    scenarioId: string
    scenario: ScenarioRecord
}) {
    const directTraceId = extractTraceIdFromScenario(scenario)
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const effectiveTraceId = directTraceId || traceRef.traceId || ""

    const inputs = useAtomValue(traceInputsAtomFamily(effectiveTraceId || null))

    if (!effectiveTraceId || !inputs || Object.keys(inputs).length === 0) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    return <SmartCellContent value={inputs} keyPrefix={`trace-input-${scenarioId}`} maxLines={3} />
})

const TraceOutputCell = memo(function TraceOutputCell({
    scenarioId,
    scenario,
}: {
    scenarioId: string
    scenario: ScenarioRecord
}) {
    const directTraceId = extractTraceIdFromScenario(scenario)
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const effectiveTraceId = directTraceId || traceRef.traceId || ""

    const outputs = useAtomValue(traceOutputsAtomFamily(effectiveTraceId || null))

    if (!effectiveTraceId || outputs === null || outputs === undefined) {
        return <Typography.Text type="secondary">—</Typography.Text>
    }

    return (
        <SmartCellContent
            value={outputs}
            keyPrefix={`trace-output-${scenarioId}`}
            maxLines={3}
            chatPreference="output"
        />
    )
})

const TraceNameCell = memo(function TraceNameCell({
    scenarioId,
    scenario,
}: {
    scenarioId: string
    scenario: ScenarioRecord
}) {
    const directTraceId = extractTraceIdFromScenario(scenario)
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const effectiveTraceId = directTraceId || traceRef.traceId || ""

    const traceQuery = useAtomValue(traceEntityAtomFamily(effectiveTraceId || null))
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(effectiveTraceId || null))

    if (!effectiveTraceId) return <Typography.Text type="secondary">—</Typography.Text>
    if (traceQuery.isPending) return <Typography.Text type="secondary">...</Typography.Text>

    return (
        <div className="flex items-center gap-1.5">
            <Typography.Text className="text-xs font-medium" ellipsis>
                {rootSpan?.span_name || "—"}
            </Typography.Text>
            {rootSpan?.span_type && (
                <Typography.Text
                    type="secondary"
                    className="text-[10px] px-1 py-0.5 rounded bg-[var(--ant-color-fill-tertiary)] shrink-0"
                >
                    {rootSpan.span_type}
                </Typography.Text>
            )}
        </div>
    )
})

// ============================================================================
// ANNOTATION CELL RENDERERS (mapping-driven)
// ============================================================================

const AnnotationColumnHeader = memo(function AnnotationColumnHeader({
    def,
}: {
    def: AnnotationColumnDef
}) {
    const name = useAtomValue(workflowMolecule.selectors.name(def.evaluatorId ?? ""))
    const slug = useAtomValue(workflowMolecule.selectors.slug(def.evaluatorId ?? ""))
    const displayName = name || slug || def.evaluatorSlug || def.columnName || def.stepKey

    return (
        <Tooltip title={slug ? `${displayName} (${slug})` : displayName}>
            <span className="truncate">{displayName}</span>
        </Tooltip>
    )
})

/**
 * Group header for a foldable evaluator column group.
 * Resolves the evaluator display name and renders the collapse toggle.
 */
const AnnotationGroupHeader = memo(function AnnotationGroupHeader({
    def,
    childCount,
    isCollapsed,
    onToggle,
}: {
    def: AnnotationColumnDef
    childCount: number
    isCollapsed: boolean
    onToggle: () => void
}) {
    const name = useAtomValue(workflowMolecule.selectors.name(def.evaluatorId ?? ""))
    const slug = useAtomValue(workflowMolecule.selectors.slug(def.evaluatorId ?? ""))
    const displayName = name || slug || def.evaluatorSlug || def.columnName || def.stepKey

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            onToggle()
        },
        [onToggle],
    )

    return (
        <Tooltip title={slug ? `${displayName} (${slug})` : displayName}>
            <span
                className="inline-flex items-center gap-1 cursor-pointer select-none truncate"
                onClick={handleClick}
            >
                {isCollapsed ? (
                    <CaretRight size={12} weight="bold" />
                ) : (
                    <CaretDown size={12} weight="bold" />
                )}
                <span className="truncate">{displayName}</span>
                <span className="text-[var(--ant-color-text-quaternary)] text-xs font-normal">
                    ({childCount})
                </span>
            </span>
        </Tooltip>
    )
})

/**
 * Shared hook for annotation cell fallback logic.
 * Resolves testcase data for a scenario and computes the fallback value
 * to show when no annotation value exists yet.
 */
function useAnnotationCellFallback(
    scenarioId: string,
    fallbackDataKey: string | null | undefined,
    outputKey?: string,
) {
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const testcaseId = fallbackDataKey ? testcaseRef.testcaseId || null : null
    const testcaseQuery = useAtomValue(
        annotationSessionController.selectors.testcaseData(testcaseId ?? ""),
    )

    const isPending = testcaseId ? (testcaseQuery?.isPending ?? false) : false
    const testcaseData = testcaseId ? (testcaseQuery?.data?.data ?? null) : null

    let fallbackValue: unknown = null
    if (fallbackDataKey && testcaseData) {
        const raw = testcaseData[fallbackDataKey] ?? null
        if (outputKey) {
            // For sub-column: drill into the container object
            fallbackValue =
                raw && typeof raw === "object" && !Array.isArray(raw)
                    ? ((raw as Record<string, unknown>)[outputKey] ?? null)
                    : null
        } else {
            fallbackValue = raw
        }
    }

    const chatPreference = fallbackDataKey
        ? OUTPUT_KEYS.has(fallbackDataKey.toLowerCase())
            ? "output"
            : "input"
        : undefined

    return {fallbackValue, isPending, chatPreference}
}

const AnnotationColumnCell = memo(function AnnotationColumnCell({
    scenarioId,
    def,
    fallbackDataKey,
}: {
    scenarioId: string
    def: AnnotationColumnDef
    fallbackDataKey?: string | null
}) {
    const runId = useAtomValue(annotationSessionController.selectors.activeRunId()) ?? undefined
    const PopoverWrapper = useMetricPopoverWrapper()
    const {fallbackValue, isPending, chatPreference} = useAnnotationCellFallback(
        scenarioId,
        fallbackDataKey,
    )

    const {value, stats: rawStats} = useAtomValue(
        annotationSessionController.selectors.scenarioMetricForEvaluator({
            scenarioId,
            evaluatorId: def.evaluatorId,
            evaluatorSlug: def.evaluatorSlug,
            path: def.path,
            stepKey: def.stepKey,
        }),
    )

    const showDistribution =
        isDistributionType(rawStats) &&
        hasDistributionData(rawStats ? extractBasicStats(rawStats) : undefined)
    const hasAnnotationValue =
        rawStats !== null && rawStats !== undefined ? true : value !== null && value !== undefined

    const cellContent = hasAnnotationValue ? (
        showDistribution ? (
            <MetricCellContent value={rawStats} showDistribution className="metric-cell-content" />
        ) : (
            <MetricValueDisplay value={value} />
        )
    ) : isPending && fallbackDataKey ? (
        <Typography.Text type="secondary">...</Typography.Text>
    ) : fallbackValue !== null && fallbackValue !== undefined ? (
        <SmartCellContent
            value={fallbackValue}
            keyPrefix={`merged-annot-${fallbackDataKey}-${scenarioId}`}
            maxLines={3}
            chatPreference={chatPreference}
        />
    ) : (
        <Typography.Text type="secondary">—</Typography.Text>
    )

    if (PopoverWrapper && hasAnnotationValue) {
        return (
            <PopoverWrapper
                runId={runId}
                metricKey={def.path ?? undefined}
                metricPath={def.path ?? undefined}
                metricLabel={def.columnName ?? def.evaluatorSlug ?? undefined}
                stepKey={def.stepKey}
                stepType="annotation"
                highlightValue={value}
                fallbackValue={value}
                evaluationType="human"
                prefetchedStats={rawStats}
            >
                {cellContent}
            </PopoverWrapper>
        )
    }

    return cellContent
})

/**
 * Cell renderer for a single output key within an evaluator column group.
 * Resolves the annotation matching the evaluator and reads a specific output key.
 */
const AnnotationOutputKeyCell = memo(function AnnotationOutputKeyCell({
    scenarioId,
    def,
    outputKey,
    fallbackDataKey,
}: {
    scenarioId: string
    def: AnnotationColumnDef
    outputKey: string
    fallbackDataKey?: string | null
}) {
    const runId = useAtomValue(annotationSessionController.selectors.activeRunId()) ?? undefined
    const PopoverWrapper = useMetricPopoverWrapper()
    const {fallbackValue, isPending} = useAnnotationCellFallback(
        scenarioId,
        fallbackDataKey,
        outputKey,
    )

    const {value, stats: rawStats} = useAtomValue(
        annotationSessionController.selectors.scenarioMetricForEvaluator({
            scenarioId,
            evaluatorId: def.evaluatorId,
            evaluatorSlug: def.evaluatorSlug,
            path: outputKey,
            stepKey: def.stepKey,
        }),
    )

    const showDistribution =
        isDistributionType(rawStats) &&
        hasDistributionData(rawStats ? extractBasicStats(rawStats) : undefined)
    const hasAnnotationValue =
        rawStats !== null && rawStats !== undefined ? true : value !== null && value !== undefined

    const cellContent = hasAnnotationValue ? (
        showDistribution ? (
            <MetricCellContent value={rawStats} showDistribution className="metric-cell-content" />
        ) : (
            <MetricValueDisplay value={value} />
        )
    ) : isPending && fallbackDataKey ? (
        <Typography.Text type="secondary">...</Typography.Text>
    ) : fallbackValue !== null && fallbackValue !== undefined ? (
        <SmartCellContent
            value={fallbackValue}
            keyPrefix={`merged-annot-${fallbackDataKey}-${outputKey}-${scenarioId}`}
            maxLines={3}
            chatPreference="output"
        />
    ) : (
        <Typography.Text type="secondary">—</Typography.Text>
    )

    if (PopoverWrapper && hasAnnotationValue) {
        return (
            <PopoverWrapper
                runId={runId}
                metricKey={outputKey}
                metricPath={outputKey}
                metricLabel={def.columnName ?? def.evaluatorSlug ?? undefined}
                stepKey={def.stepKey}
                stepType="annotation"
                highlightValue={value}
                fallbackValue={value}
                evaluationType="human"
                prefetchedStats={rawStats}
            >
                {cellContent}
            </PopoverWrapper>
        )
    }

    return cellContent
})

// ============================================================================
// COLLAPSIBLE GROUP HEADER
// ============================================================================

const GroupHeaderTitle = memo(function GroupHeaderTitle({
    title,
    childCount,
    isCollapsed,
    onToggle,
}: {
    title: string
    childCount: number
    isCollapsed: boolean
    onToggle: () => void
}) {
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            onToggle()
        },
        [onToggle],
    )

    return (
        <span
            className="inline-flex items-center gap-1 cursor-pointer select-none"
            onClick={handleClick}
        >
            {isCollapsed ? (
                <CaretRight size={12} weight="bold" />
            ) : (
                <CaretDown size={12} weight="bold" />
            )}
            <span>{title}</span>
            <span className="text-[var(--ant-color-text-quaternary)] text-xs font-normal">
                ({childCount})
            </span>
        </span>
    )
})

// ============================================================================
// COLUMN DEF → ANTD COLUMN MAPPER
// ============================================================================

/**
 * Maps a ScenarioListColumnDef to an AntD column config.
 * This is the single bridge between state-driven column definitions
 * and presentation-layer rendering.
 */
function mapDefToColumn(
    def: ScenarioListColumnDef,
    actions: {
        setDrawerScenarioId: (id: string) => void
        navigateToIndex: (index: number) => void
        setActiveView: (view: SessionView) => void
    },
    collapsedGroups: Set<string>,
    toggleGroupCollapse: (groupKey: string) => void,
) {
    const base = {
        key: def.key,
        title: def.title,
        dataIndex: def.key,
        width: def.width,
        minWidth: def.width,
        fixed: def.fixed,
        onHeaderCell: () => ({style: {minWidth: def.width, textAlign: "left" as const}}),
    }

    switch (def.columnType) {
        case "index":
            return {
                ...base,
                columnVisibilityLocked: true,
                render: (_value: unknown, record: ScenarioTableRow) => {
                    if (record.__isSkeleton) return null
                    const statusKey = (record.status ?? "pending").toLowerCase()
                    const tag = STATUS_TAG_MAP[statusKey] ?? DEFAULT_STATUS_TAG
                    const isComplete = record.status === "success"

                    return (
                        <Tooltip title={tag.label} placement="topLeft">
                            <span className="inline-flex items-center gap-2 text-xs font-medium">
                                {isComplete ? (
                                    <Check size={12} weight="bold" className="text-emerald-600" />
                                ) : (
                                    <span
                                        className="h-2 w-2 rounded-full"
                                        style={{
                                            backgroundColor: `var(--ant-color-${tag.color === "orange" ? "warning" : tag.color})`,
                                        }}
                                    />
                                )}
                                <span className={isComplete ? "text-emerald-700" : "text-zinc-600"}>
                                    {record.scenarioIndex + 1}
                                </span>
                            </span>
                        </Tooltip>
                    )
                },
            }

        case "trace-name":
            return {
                ...base,
                render: (_value: unknown, record: ScenarioTableRow) => (
                    <TraceNameCell scenarioId={record.scenarioId} scenario={record.raw} />
                ),
            }

        case "trace-input-group": {
            const isCollapsed = collapsedGroups.has(def.key)

            // Multiple keys → foldable grouped column
            if (def.inputKeys.length > 1) {
                const groupHeader = (
                    <GroupHeaderTitle
                        title={def.title}
                        childCount={def.inputKeys.length}
                        isCollapsed={isCollapsed}
                        onToggle={() => toggleGroupCollapse(def.key)}
                    />
                )

                if (isCollapsed) {
                    // Collapsed: single column showing all inputs
                    return {
                        ...base,
                        title: groupHeader,
                        width: 300,
                        minWidth: 300,
                        onHeaderCell: () => ({style: {minWidth: 300, textAlign: "left" as const}}),
                        render: (_value: unknown, record: ScenarioTableRow) => (
                            <TraceInputCell scenarioId={record.scenarioId} scenario={record.raw} />
                        ),
                    }
                }

                // Expanded: children sub-columns
                return {
                    title: groupHeader,
                    key: def.key,
                    onHeaderCell: () => ({style: {textAlign: "left" as const}}),
                    children: def.inputKeys.map((inputKey) => ({
                        title: inputKey,
                        key: `__trace_input_${inputKey}`,
                        dataIndex: `__trace_input_${inputKey}`,
                        width: 250,
                        minWidth: 250,
                        onHeaderCell: () => ({style: {minWidth: 250, textAlign: "left" as const}}),
                        render: (_value: unknown, record: ScenarioTableRow) => (
                            <TraceInputKeyCell
                                scenarioId={record.scenarioId}
                                scenario={record.raw}
                                inputKey={inputKey}
                            />
                        ),
                    })),
                }
            }
            // Single key → flat column with key as title
            if (def.inputKeys.length === 1) {
                return {
                    ...base,
                    title: def.inputKeys[0],
                    render: (_value: unknown, record: ScenarioTableRow) => (
                        <TraceInputKeyCell
                            scenarioId={record.scenarioId}
                            scenario={record.raw}
                            inputKey={def.inputKeys[0]}
                        />
                    ),
                }
            }
            // No keys discovered yet → fallback showing all inputs
            return {
                ...base,
                render: (_value: unknown, record: ScenarioTableRow) => (
                    <TraceInputCell scenarioId={record.scenarioId} scenario={record.raw} />
                ),
            }
        }

        case "trace-output":
            return {
                ...base,
                render: (_value: unknown, record: ScenarioTableRow) => (
                    <TraceOutputCell scenarioId={record.scenarioId} scenario={record.raw} />
                ),
            }

        case "testcase-input":
            return {
                ...base,
                render: (_value: unknown, record: ScenarioTableRow) => (
                    <TestcaseDataCell
                        scenarioId={record.scenarioId}
                        dataKey={def.dataKey}
                        chatPreference="input"
                    />
                ),
            }

        case "testcase-output":
            return {
                ...base,
                render: (_value: unknown, record: ScenarioTableRow) => (
                    <TestcaseDataCell
                        scenarioId={record.scenarioId}
                        dataKey={def.dataKey}
                        chatPreference="output"
                    />
                ),
            }

        case "testcase-expected":
            return {
                ...base,
                render: (_value: unknown, record: ScenarioTableRow) => (
                    <TestcaseDataCell scenarioId={record.scenarioId} dataKey={def.dataKey} />
                ),
            }

        case "annotation": {
            const annotDef = def.annotationDef
            const outputKeys = def.outputKeys

            // Multiple output keys → foldable column group with sub-columns per key
            if (outputKeys.length > 1) {
                const isCollapsed = collapsedGroups.has(def.key)
                const groupHeader = (
                    <AnnotationGroupHeader
                        def={annotDef}
                        childCount={outputKeys.length}
                        isCollapsed={isCollapsed}
                        onToggle={() => toggleGroupCollapse(def.key)}
                    />
                )

                if (isCollapsed) {
                    // Collapsed: single column showing all outputs together
                    return {
                        ...base,
                        title: groupHeader,
                        width: 200,
                        minWidth: 200,
                        onHeaderCell: () => ({
                            style: {minWidth: 200, textAlign: "left" as const},
                        }),
                        render: (_value: unknown, record: ScenarioTableRow) => (
                            <AnnotationColumnCell
                                scenarioId={record.scenarioId}
                                def={annotDef}
                                fallbackDataKey={def.fallbackDataKey}
                            />
                        ),
                    }
                }

                // Expanded: children sub-columns per output key
                return {
                    title: groupHeader,
                    key: def.key,
                    onHeaderCell: () => ({style: {textAlign: "left" as const}}),
                    children: outputKeys.map((outputKey) => ({
                        title: outputKey,
                        key: `${def.key}_${outputKey}`,
                        dataIndex: `${def.key}_${outputKey}`,
                        width: 150,
                        minWidth: 150,
                        onHeaderCell: () => ({
                            style: {minWidth: 150, textAlign: "left" as const},
                        }),
                        render: (_value: unknown, record: ScenarioTableRow) => (
                            <AnnotationOutputKeyCell
                                scenarioId={record.scenarioId}
                                def={annotDef}
                                outputKey={outputKey}
                                fallbackDataKey={def.fallbackDataKey}
                            />
                        ),
                    })),
                }
            }

            // Single output key → flat column reading that key directly
            if (outputKeys.length === 1) {
                return {
                    ...base,
                    title: <AnnotationColumnHeader def={annotDef} />,
                    render: (_value: unknown, record: ScenarioTableRow) => (
                        <AnnotationOutputKeyCell
                            scenarioId={record.scenarioId}
                            def={annotDef}
                            outputKey={outputKeys[0]}
                            fallbackDataKey={def.fallbackDataKey}
                        />
                    ),
                }
            }

            // No output keys discovered → fallback to full annotation cell
            return {
                ...base,
                title: <AnnotationColumnHeader def={annotDef} />,
                render: (_value: unknown, record: ScenarioTableRow) => (
                    <AnnotationColumnCell
                        scenarioId={record.scenarioId}
                        def={annotDef}
                        fallbackDataKey={def.fallbackDataKey}
                    />
                ),
            }
        }

        case "status":
            return {
                ...base,
                render: (_value: unknown, record: ScenarioTableRow) => {
                    if (record.__isSkeleton) return null
                    const statusKey = (record.status ?? "pending").toLowerCase()
                    const tag = STATUS_TAG_MAP[statusKey] ?? DEFAULT_STATUS_TAG
                    return <Tag color={tag.color}>{tag.label}</Tag>
                },
            }

        case "actions":
            return createActionsColumn<ScenarioTableRow>({
                type: "actions",
                width: def.width,
                maxWidth: 48,
                showCopyId: false,
                items: [
                    {
                        key: "annotate",
                        label: "Annotate",
                        icon: <NotePencil size={16} />,
                        onClick: (record) => actions.setDrawerScenarioId(record.scenarioId),
                    },
                    {
                        key: "focus",
                        label: "Open in Focus View",
                        icon: <Eye size={16} />,
                        onClick: (record) => {
                            actions.navigateToIndex(record.scenarioIndex)
                            actions.setActiveView("annotate")
                        },
                    },
                ],
                getRecordId: (record) => record.scenarioId,
            })

        default:
            return base
    }
}

// ============================================================================
// ANNOTATION DRAWER
// ============================================================================

interface AnnotationDrawerProps {
    scenarioId: string | null
    queueId: string
    open: boolean
    onClose: () => void
    onSaved: () => void
    onCompleted: (scenarioId: string) => void
}

const AnnotationDrawer = memo(function AnnotationDrawer({
    scenarioId,
    queueId,
    open,
    onClose,
    onSaved,
    onCompleted,
}: AnnotationDrawerProps) {
    const navigation = useAnnotationNavigation()
    const scenarios = useAtomValue(
        annotationSessionController.selectors.scenarioRecords(),
    ) as ScenarioRecord[]
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId ?? ""),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId ?? ""),
    )

    const scenario = useMemo(
        () => scenarios.find((s) => s.id === scenarioId) ?? null,
        [scenarios, scenarioId],
    )
    const directTraceId = scenario ? extractTraceIdFromScenario(scenario) : ""
    const effectiveTraceId = directTraceId || traceRef.traceId

    const isTrace = queueKind === "traces" && !!effectiveTraceId
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(isTrace ? effectiveTraceId : null))

    const handleViewTrace = useCallback(() => {
        if (effectiveTraceId && navigation.openTraceDetail) {
            navigation.openTraceDetail(effectiveTraceId, rootSpan?.span_id)
        }
    }, [effectiveTraceId, rootSpan?.span_id, navigation])

    const drawerExtra = useMemo(() => {
        if (!isTrace || !navigation.openTraceDetail) return null
        return (
            <Button size="small" icon={<ArrowSquareOut size={14} />} onClick={handleViewTrace}>
                View Full Trace
            </Button>
        )
    }, [isTrace, navigation.openTraceDetail, handleViewTrace])

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={
                <div className="w-full flex items-center gap-2">
                    <Typography.Text className="whitespace-nowrap">
                        Annotate Scenario
                    </Typography.Text>
                    {/* <SessionNavigation /> */}
                </div>
            }
            extra={drawerExtra}
            destroyOnClose
            styles={{
                body: {padding: 24, display: "flex", flexDirection: "row"},
                wrapper: {width: 1100},
            }}
        >
            {scenarioId && (
                <div className="flex flex-row h-full w-full gap-4">
                    {/* Left panel: Scenario content */}
                    <div className="flex-1 overflow-y-auto">
                        <ScenarioContent
                            scenario={scenario}
                            queueKind={queueKind || "traces"}
                            traceId={effectiveTraceId}
                            testcaseId={testcaseRef.testcaseId}
                        />
                    </div>

                    {/* Right panel: Annotation form */}
                    <div className="w-[340px] min-w-[280px] shrink-0 border border-solid border-[var(--ant-color-border-secondary)] rounded-lg overflow-hidden">
                        <AnnotationPanel
                            scenarioId={scenarioId}
                            queueId={queueId}
                            onSaved={onSaved}
                            onCompleted={onCompleted}
                        />
                    </div>
                </div>
            )}
        </Drawer>
    )
})

// ============================================================================
// TABLE SCOPE CONFIG
// ============================================================================

const TABLE_SCOPE: TableScopeConfig = {
    scopeId: "annotation-session-scenarios",
    pageSize: 200,
    enableInfiniteScroll: false,
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const ScenarioListView = memo(function ScenarioListView({
    queueId,
    onSaved,
    onCompleted,
    onViewChange,
}: ScenarioListViewProps) {
    const setActiveView = useSetAtom(annotationSessionController.actions.setActiveView)
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)
    const listColumnDefs = useAtomValue(annotationSessionController.selectors.listColumnDefs())
    const handleViewChange = useCallback(
        (view: SessionView) => {
            if (onViewChange) {
                onViewChange(view)
                return
            }

            setActiveView(view)
        },
        [onViewChange, setActiveView],
    )

    // Read scenarios and statuses from controller (derived from simpleQueueMolecule)
    const scenarios = useAtomValue(
        annotationSessionController.selectors.scenarioRecords(),
    ) as ScenarioRecord[]
    const scenarioStatuses = useAtomValue(annotationSessionController.selectors.scenarioStatuses())

    const [drawerScenarioId, setDrawerScenarioId] = useState<string | null>(null)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

    const toggleGroupCollapse = useCallback((groupKey: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(groupKey)) {
                next.delete(groupKey)
            } else {
                next.add(groupKey)
            }
            return next
        })
    }, [])

    // Build table rows
    const rows: ScenarioTableRow[] = useMemo(() => {
        return scenarios.map((scenario, index) => {
            const id = scenario.id as string
            return {
                key: id || String(index),
                scenarioIndex: index,
                scenarioId: id,
                status: scenarioStatuses[id] ?? null,
                raw: scenario,
            }
        })
    }, [scenarios, scenarioStatuses])

    // Map column defs to AntD columns (purely presentational mapping)
    const columns = useMemo(() => {
        const columnActions = {
            setDrawerScenarioId,
            navigateToIndex,
            setActiveView: handleViewChange,
        }
        return listColumnDefs.map((def) =>
            mapDefToColumn(def, columnActions, collapsedGroups, toggleGroupCollapse),
        )
    }, [
        listColumnDefs,
        setDrawerScenarioId,
        navigateToIndex,
        handleViewChange,
        collapsedGroups,
        toggleGroupCollapse,
    ])

    // Pagination (in-memory — all rows, no server pagination)
    const pagination = useMemo(
        () => ({
            rows,
            loadNextPage: () => {},
            resetPages: () => {},
        }),
        [rows],
    )

    // Row click opens annotation drawer
    const handleRowClick = useCallback((_event: React.MouseEvent, record: ScenarioTableRow) => {
        const target = _event.target as HTMLElement
        if (target?.closest("[data-ivt-stop-row-click]")) return
        setDrawerScenarioId(record.scenarioId)
    }, [])

    const handleDrawerClose = useCallback(() => {
        setDrawerScenarioId(null)
    }, [])

    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            sticky: true,
            virtual: true,
            bordered: true,
            tableLayout: "fixed" as const,
            onRow: (record: ScenarioTableRow) => ({
                onClick: (event: React.MouseEvent) => handleRowClick(event, record),
                className: "cursor-pointer",
            }),
        }),
        [handleRowClick],
    )

    return (
        <div className="flex flex-col h-full w-full min-h-0">
            <InfiniteVirtualTableFeatureShell<ScenarioTableRow>
                tableScope={TABLE_SCOPE}
                columns={columns}
                rowKey={(record) => record.key}
                pagination={pagination}
                tableProps={tableProps}
                resizableColumns
                autoHeight
                useSettingsDropdown
                tableClassName="agenta-scenario-table"
                className="flex-1 min-h-0"
                store={getDefaultStore()}
            />

            <AnnotationDrawer
                scenarioId={drawerScenarioId}
                queueId={queueId}
                open={!!drawerScenarioId}
                onClose={handleDrawerClose}
                onSaved={onSaved}
                onCompleted={onCompleted}
            />
        </div>
    )
})

export default ScenarioListView
