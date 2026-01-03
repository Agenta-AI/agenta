import type {ReactNode} from "react"
import {memo, useCallback, useMemo, useRef, useState} from "react"
import {isValidElement} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Popover, Skeleton, Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {AlertCircle} from "lucide-react"
import dynamic from "next/dynamic"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/Evaluations/atoms/runMetrics"
import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"
import GenericDrawer from "@/oss/components/GenericDrawer"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import ReadOnlyBox from "../../pages/evaluations/onlineEvaluation/components/ReadOnlyBox"
import {invocationTraceSummaryAtomFamily} from "../atoms/invocationTraceSummary"
import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
    variantReferenceQueryAtomFamily,
} from "../atoms/references"
import {runDisplayNameAtomFamily} from "../atoms/runDerived"
import type {
    ColumnValueDescriptor,
    EvaluationTableColumn,
    MetricColumnDefinition,
} from "../atoms/table"
import type {EvaluationTableColumnGroup} from "../atoms/table"
import {
    columnValueDescriptorMapAtomFamily,
    createColumnValueDescriptor,
} from "../atoms/table/columnAccess"
import {evaluationRunIndexAtomFamily} from "../atoms/table/run"
import usePreviewTableData from "../hooks/usePreviewTableData"
import useRunIdentifiers from "../hooks/useRunIdentifiers"
import useScenarioCellValue from "../hooks/useScenarioCellValue"
import {
    closeFocusDrawerAtom,
    compareScenarioMatchesAtom,
    focusScenarioAtom,
    isFocusDrawerOpenAtom,
    resetFocusDrawerAtom,
} from "../state/focusDrawerAtom"
import {clearFocusDrawerQueryParams} from "../state/urlFocusDrawer"
import {renderScenarioChatMessages} from "../utils/chatMessages"
import {formatMetricDisplay, METRIC_EMPTY_PLACEHOLDER} from "../utils/metricFormatter"

import EvaluationRunTag from "./EvaluationRunTag"
import FocusDrawerHeader from "./FocusDrawerHeader"
import FocusDrawerSidePanel from "./FocusDrawerSidePanel"
import {SectionCard} from "./views/ConfigurationView/components/SectionPrimitives"

const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

// Color palette for category tags (same as MetricCell)
const TAG_COLORS = ["green", "blue", "purple", "orange", "cyan", "magenta", "gold", "lime"]

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

const {Text} = Typography

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
    /** When true, disables internal scrolling (for use in compare mode with shared scroll container) */
    disableScroll?: boolean
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
    group: EvaluationTableColumnGroup
}

/**
 * Hook to compute sections for a given run
 */
const useFocusDrawerSections = (runId: string | null) => {
    const {columnResult} = usePreviewTableData({runId: runId ?? undefined})
    const descriptorMap = useAtomValue(
        useMemo(() => columnValueDescriptorMapAtomFamily(runId), [runId]),
    )
    const runIndex = useAtomValue(useMemo(() => evaluationRunIndexAtomFamily(runId), [runId]))

    const groups = columnResult?.groups ?? []
    const columnMap = useMemo(() => {
        const map = new Map<string, EvaluationTableColumn>()
        columnResult?.columns.forEach((column) => {
            map.set(column.id, column)
        })
        return map
    }, [columnResult?.columns])

    const sections = useMemo<FocusDrawerSection[]>(() => {
        const resolveDescriptor = (column: EvaluationTableColumn) =>
            descriptorMap?.[column.id] ?? createColumnValueDescriptor(column, runIndex)

        return groups
            .map((group) => {
                if (group.kind === "metric") {
                    return null
                }

                const sectionLabel = group.label

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
                    group,
                }
            })
            .filter((section): section is FocusDrawerSection => Boolean(section))
    }, [columnMap, descriptorMap, groups, runIndex])

    return {sections, isLoading: !columnResult}
}

interface InvocationRefs {
    applicationId: string | null
    applicationVariantId: string | null
    variantRevision: string | number | null
}

const useInvocationRefs = (
    group: EvaluationTableColumnGroup | null,
    runId: string | null,
): InvocationRefs => {
    const runIdentifiers = useRunIdentifiers(runId)

    const applicationId =
        (group?.meta?.refs?.application?.id as string | undefined) ??
        (group?.meta?.refs?.app?.id as string | undefined) ??
        (group?.meta?.refs?.agent?.id as string | undefined) ??
        (group?.meta?.refs?.tool?.id as string | undefined) ??
        runIdentifiers.applicationId ??
        null
    const applicationVariantId =
        (group?.meta?.refs?.variant?.id as string | undefined) ??
        (group?.meta?.refs?.application_variant?.id as string | undefined) ??
        runIdentifiers.variantId ??
        runIdentifiers.applicationVariantId ??
        null
    const variantRevision =
        (group?.meta?.refs?.variant?.revision as string | number | undefined) ??
        (group?.meta?.refs?.variant?.version as string | number | undefined) ??
        (group?.meta?.refs?.application_variant?.revision as string | number | undefined) ??
        (group?.meta?.refs?.application_variant?.version as string | number | undefined) ??
        (runIdentifiers.rawRefs?.variant?.revision as string | number | undefined) ??
        (runIdentifiers.rawRefs?.variant?.version as string | number | undefined) ??
        (runIdentifiers.rawRefs?.applicationVariant?.revision as string | number | undefined) ??
        (runIdentifiers.rawRefs?.applicationVariant?.version as string | number | undefined) ??
        null

    return {applicationId, applicationVariantId, variantRevision}
}

const FocusGroupLabel = ({
    group,
    label,
    runId,
}: {
    group: EvaluationTableColumnGroup | null
    label: string
    runId: string | null
}) => {
    const testsetId = group?.meta?.refs?.testset?.id as string | undefined
    const {
        applicationId,
        applicationVariantId,
        variantRevision: _variantRevision,
    } = useInvocationRefs(group, runId)

    const appQuery = useAtomValue(
        useMemo(() => applicationReferenceQueryAtomFamily(applicationId ?? null), [applicationId]),
    )
    const testsetQuery = useAtomValue(
        useMemo(() => testsetReferenceQueryAtomFamily(testsetId ?? null), [testsetId]),
    )
    const _variantQuery = useAtomValue(
        useMemo(
            () => variantReferenceQueryAtomFamily(applicationVariantId ?? null),
            [applicationVariantId],
        ),
    )

    if (group?.kind === "input" && testsetId && testsetQuery.data?.name) {
        return "Input"
    }

    if (group?.kind === "invocation") {
        const applicationLabel =
            appQuery.data?.name ?? appQuery.data?.slug ?? appQuery.data?.id ?? applicationId ?? null

        if (applicationLabel) return "Outputs"
    }

    return <>{label}</>
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

/**
 * Strip evaluator/group name prefix from a label to avoid redundancy.
 * e.g., "New Human IsAwesome" -> "IsAwesome" when groupLabel is "New Human"
 */
const stripGroupPrefix = (label: string, groupLabel?: string): string => {
    if (!groupLabel || !label) return label
    const normalizedGroup = groupLabel.toLowerCase().replace(/[-_\s]+/g, "")
    const normalizedLabel = label.toLowerCase().replace(/[-_\s]+/g, "")
    if (!normalizedLabel.startsWith(normalizedGroup)) return label

    // Find where the prefix ends in the original label
    let prefixEndIndex = 0
    let groupIndex = 0
    while (prefixEndIndex < label.length && groupIndex < groupLabel.length) {
        const labelChar = label[prefixEndIndex].toLowerCase()
        const groupChar = groupLabel[groupIndex].toLowerCase()
        if (labelChar === groupChar) {
            groupIndex++
        } else if (/[-_\s]/.test(label[prefixEndIndex])) {
            // Skip separators in label
        } else if (/[-_\s]/.test(groupLabel[groupIndex])) {
            // Skip separators in group
            groupIndex++
            continue
        } else {
            break
        }
        prefixEndIndex++
    }
    // Skip any trailing separators after the prefix
    while (prefixEndIndex < label.length && /[-_\s]/.test(label[prefixEndIndex])) {
        prefixEndIndex++
    }
    return label.slice(prefixEndIndex) || label
}

const ScenarioColumnValue = memo(
    ({
        runId,
        scenarioId,
        column,
        descriptor,
        groupLabel,
    }: {
        runId: string
        scenarioId: string
        column: EvaluationTableColumn
        descriptor: ColumnValueDescriptor
        groupLabel?: string
    }) => {
        const rawLabel = column.displayLabel ?? column.label ?? column.id
        // Strip group/evaluator name prefix from label to avoid redundancy
        const displayLabel = groupLabel ? stripGroupPrefix(rawLabel, groupLabel) : rawLabel
        const isMetric =
            column.kind === "metric" ||
            column.kind === "evaluator" ||
            column.stepType === "metric" ||
            column.stepType === "annotation"
        const isRunMetric = isRunMetricColumn(column)

        // Always call hooks unconditionally at the top level
        const {selection, showSkeleton} = useScenarioCellValue({
            scenarioId,
            runId,
            column,
            disableVisibilityTracking: true,
        })

        // Try to render as chat messages (must be called before any conditional returns)
        const chatNodes = useMemo(
            () =>
                renderScenarioChatMessages(
                    selection.value,
                    `${scenarioId}-${column.id ?? column.path ?? "col"}`,
                ),
            [scenarioId, column.id, column.path, selection.value],
        )

        // For run metric columns, delegate to RunMetricValue component
        if (isMetric && isRunMetric) {
            return (
                <RunMetricValue
                    runId={runId}
                    scenarioId={scenarioId}
                    column={column}
                    descriptor={descriptor}
                />
            )
        }

        // For metric columns (non-run metrics)
        if (isMetric) {
            const {value, displayValue} = selection

            // Ensure formattedValue is always a string
            // displayValue might be a boolean (e.g., true/false for boolean metrics)
            // which would render as nothing in React if not converted to string
            const rawFormattedValue =
                displayValue ??
                formatMetricDisplay({
                    value,
                    metricKey: descriptor.metricKey ?? descriptor.valueKey ?? descriptor.path,
                    metricType: descriptor.metricType,
                })
            const formattedValue =
                typeof rawFormattedValue === "boolean"
                    ? String(rawFormattedValue)
                    : rawFormattedValue

            const isPlaceholder = formattedValue === METRIC_EMPTY_PLACEHOLDER

            // Check if this is an array-type metric
            const isArrayMetric =
                descriptor.metricType?.toLowerCase?.() === "array" ||
                Array.isArray(value) ||
                (typeof value === "string" && value.startsWith("[") && value.endsWith("]"))

            // Parse array values into tags
            const arrayTags: string[] = (() => {
                if (!isArrayMetric) return []
                if (Array.isArray(value)) {
                    return value.map((v) => String(v)).filter(Boolean)
                }
                if (typeof value === "string" && value.startsWith("[")) {
                    try {
                        const parsed = JSON.parse(value)
                        if (Array.isArray(parsed)) {
                            return parsed.map((v) => String(v)).filter(Boolean)
                        }
                    } catch {
                        // Not valid JSON
                    }
                }
                if (typeof value === "string" && value.includes(",")) {
                    return value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean)
                }
                return []
            })()

            // Render array metrics as tags in a vertical stack
            const renderMetricContent = () => {
                if (arrayTags.length > 0) {
                    return (
                        <div className="flex flex-col gap-1">
                            {arrayTags.map((tag, index) => (
                                <Tag
                                    key={`${tag}-${index}`}
                                    color={TAG_COLORS[index % TAG_COLORS.length]}
                                    className="m-0 w-fit"
                                >
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                    )
                }
                return (
                    <span className={`${isPlaceholder ? "text-neutral-500" : "text-neutral-900"}`}>
                        {formattedValue}
                    </span>
                )
            }

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
                                {renderMetricContent()}
                            </MetricDetailsPreviewPopover>
                        )}
                    </ReadOnlyBox>
                </div>
            )
        }

        // For non-metric columns (input, invocation, annotation, etc.)
        const resolvedValue = selection.displayValue ?? selection.value
        const stepError = selection.stepError

        const renderValue = () => {
            if (showSkeleton && resolvedValue === undefined) {
                return <Skeleton active paragraph={{rows: 1}} />
            }

            // Display step error if present (e.g., invocation failure)
            if (stepError) {
                const errorPopoverContent = (
                    <div className="flex flex-col gap-2 text-red-600">
                        <div className="flex items-center gap-1.5 text-red-500">
                            <AlertCircle size={14} className="flex-shrink-0" />
                            <span className="text-xs font-medium">Invocation Error</span>
                        </div>
                        <span className="whitespace-pre-wrap break-words text-xs font-medium">
                            {stepError.message}
                        </span>
                        {stepError.stacktrace ? (
                            <span className="whitespace-pre-wrap break-words text-xs text-red-500/80 border-t border-red-200 pt-2 mt-1">
                                {stepError.stacktrace}
                            </span>
                        ) : null}
                    </div>
                )

                return (
                    <Popover
                        content={
                            <div className="max-w-[400px] max-h-[300px] overflow-auto text-xs">
                                {errorPopoverContent}
                            </div>
                        }
                        trigger="hover"
                        mouseEnterDelay={0.3}
                        mouseLeaveDelay={0.1}
                        placement="top"
                        arrow={false}
                    >
                        <div className="flex flex-col gap-1 text-red-500 cursor-help">
                            <div className="flex items-center gap-1">
                                <AlertCircle size={14} className="flex-shrink-0" />
                                <span className="font-medium">Error</span>
                            </div>
                            <Text type="danger">{stepError.message}</Text>
                        </div>
                    </Popover>
                )
            }

            if (chatNodes && chatNodes.length) {
                return <div className="flex w-full flex-col gap-2">{chatNodes}</div>
            }

            if (isValidElement(resolvedValue)) {
                return resolvedValue
            }

            if (resolvedValue === null || resolvedValue === undefined) {
                return <Text type="secondary">—</Text>
            }

            // Check if it's a JSON string that should be parsed
            if (typeof resolvedValue === "string") {
                const trimmed = resolvedValue.trim()
                if (
                    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                    (trimmed.startsWith("[") && trimmed.endsWith("]"))
                ) {
                    try {
                        const parsed = JSON.parse(trimmed)
                        const jsonString = JSON.stringify(parsed, null, 2)
                        return (
                            <div className="overflow-hidden [&_.editor-inner]:!border-0 [&_.editor-inner]:!bg-transparent [&_.editor-container]:!bg-transparent [&_.editor-code]:!bg-transparent">
                                <JsonEditor
                                    initialValue={jsonString}
                                    language="json"
                                    codeOnly
                                    showToolbar={false}
                                    disabled
                                    enableResize={false}
                                    boundWidth
                                    showLineNumbers={false}
                                    dimensions={{width: "100%", height: "auto"}}
                                />
                            </div>
                        )
                    } catch {
                        // Not valid JSON, render as text
                    }
                }
                return <Text>{resolvedValue}</Text>
            }

            if (typeof resolvedValue === "number" || typeof resolvedValue === "boolean") {
                return <Text>{String(resolvedValue)}</Text>
            }

            // For objects/arrays, use JSON editor
            try {
                const jsonString = JSON.stringify(resolvedValue, null, 2)
                return (
                    <div className="overflow-hidden [&_.editor-inner]:!border-0 [&_.editor-inner]:!bg-transparent [&_.editor-container]:!bg-transparent [&_.editor-code]:!bg-transparent">
                        <JsonEditor
                            initialValue={jsonString}
                            language="json"
                            codeOnly
                            showToolbar={false}
                            disabled
                            enableResize={false}
                            boundWidth
                            showLineNumbers={false}
                            dimensions={{width: "100%", height: "auto"}}
                        />
                    </div>
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

const EvalOutputMetaRow = memo(
    ({
        runId,
        scenarioId,
        compareIndex,
    }: {
        runId: string
        scenarioId: string
        compareIndex?: number
    }) => {
        const runDisplayNameAtom = useMemo(() => runDisplayNameAtomFamily(runId), [runId])
        const runDisplayName = useAtomValue(runDisplayNameAtom)
        const traceSummaryAtom = useMemo(
            () => invocationTraceSummaryAtomFamily({scenarioId, runId}),
            [runId, scenarioId],
        )
        const traceSummary = useAtomValue(traceSummaryAtom)
        const resolvedCompareIndex = compareIndex ?? 0

        return (
            <div className="flex flex-wrap items-center justify-between gap-2 py-2 px-4 min-w-[480px] border-[0.5px] border-solid border-[#EAEFF5]">
                <EvaluationRunTag
                    label={runDisplayName || "Evaluation"}
                    compareIndex={resolvedCompareIndex}
                />
                <SharedGenerationResultUtils
                    traceId={traceSummary.traceId}
                    showStatus={false}
                    className="flex items-center gap-1"
                />
            </div>
        )
    },
)

EvalOutputMetaRow.displayName = "EvalOutputMetaRow"

const FocusSectionHeader = ({
    title,
    collapsed,
    onToggle,
}: {
    title: ReactNode
    collapsed: boolean
    onToggle: () => void
}) => (
    <div className="flex items-center justify-between py-1 px-3 h-10 sticky top-0 bg-zinc-1 z-10">
        <Text className="text-sm font-semibold text-[#344054]">{title}</Text>
        <Button
            type="link"
            size="small"
            icon={<DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />}
            onClick={onToggle}
        />
    </div>
)

const FocusSectionContent = memo(
    ({
        section,
        runId,
        scenarioId,
    }: {
        section: FocusDrawerSection
        runId: string
        scenarioId: string
    }) => {
        const isInputSection = section.group?.kind === "input"

        return (
            <div
                className={clsx(
                    "flex flex-col gap-3",
                    isInputSection && "max-h-[240px] overflow-auto",
                )}
            >
                {section.group?.kind === "invocation" ? (
                    <InvocationMetaChips group={section.group} runId={runId} />
                ) : null}

                {section.columns.map(({column, descriptor}) => (
                    <ScenarioColumnValue
                        key={column.id}
                        runId={runId}
                        scenarioId={scenarioId}
                        column={column}
                        descriptor={descriptor}
                        groupLabel={section.label}
                    />
                ))}
            </div>
        )
    },
)

FocusSectionContent.displayName = "FocusSectionContent"

const FocusDrawerSectionCard = memo(
    ({
        section,
        runId,
        scenarioId,
    }: {
        section: FocusDrawerSection
        runId: string
        scenarioId: string
    }) => {
        const [collapsed, setCollapsed] = useState(false)
        const sectionLabelNode = useMemo(
            () => <FocusGroupLabel group={section.group} label={section.label} runId={runId} />,
            [runId, section.group, section.label],
        )

        return (
            <div id={section.anchorId} className="flex flex-col">
                <FocusSectionHeader
                    title={sectionLabelNode}
                    collapsed={collapsed}
                    onToggle={() => setCollapsed((value) => !value)}
                />
                {!collapsed ? (
                    <div className="pb-2">
                        <SectionCard className="gap-4">
                            <FocusSectionContent
                                section={section}
                                runId={runId}
                                scenarioId={scenarioId}
                            />
                        </SectionCard>
                    </div>
                ) : null}
            </div>
        )
    },
)

FocusDrawerSectionCard.displayName = "FocusDrawerSectionCard"

const InvocationMetaChips = memo(
    ({group, runId}: {group: EvaluationTableColumnGroup | null; runId: string | null}) => {
        const {applicationId, applicationVariantId, variantRevision} = useInvocationRefs(
            group,
            runId,
        )

        const appQuery = useAtomValue(
            useMemo(
                () => applicationReferenceQueryAtomFamily(applicationId ?? null),
                [applicationId],
            ),
        )
        const variantQuery = useAtomValue(
            useMemo(
                () => variantReferenceQueryAtomFamily(applicationVariantId ?? null),
                [applicationVariantId],
            ),
        )

        const appLabel =
            appQuery.data?.name ?? appQuery.data?.slug ?? appQuery.data?.id ?? applicationId ?? null
        const variantLabel =
            variantQuery.data?.name ??
            variantQuery.data?.slug ??
            variantQuery.data?.id ??
            applicationVariantId ??
            null
        const resolvedVariantRevision =
            variantQuery.data?.revision !== undefined && variantQuery.data?.revision !== null
                ? String(variantQuery.data.revision)
                : variantRevision !== undefined && variantRevision !== null
                  ? String(variantRevision)
                  : null

        if (!appLabel && !variantLabel) {
            return null
        }

        const revisionBadge =
            resolvedVariantRevision && resolvedVariantRevision.length
                ? resolvedVariantRevision.startsWith("v")
                    ? resolvedVariantRevision
                    : `v${resolvedVariantRevision}`
                : null

        return (
            <div className="flex flex-col">
                {appLabel ? <span className="font-medium text-[#101828]">{appLabel}</span> : null}
                {variantLabel ? (
                    <div className="flex items-center gap-2 text-[#475467]">
                        <span>{variantLabel}</span>
                        {revisionBadge ? (
                            <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-xs font-semibold text-[#344054]">
                                {revisionBadge}
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        )
    },
)

InvocationMetaChips.displayName = "InvocationMetaChips"

/**
 * Single run column content within a section (for compare mode)
 */
const CompareRunColumnContent = memo(
    ({
        runId,
        scenarioId,
        section,
    }: {
        runId: string
        scenarioId: string
        section: FocusDrawerSection
    }) => {
        return (
            <SectionCard className="flex-1 min-w-[480px] shrink-0 gap-4">
                <FocusSectionContent section={section} runId={runId} scenarioId={scenarioId} />
            </SectionCard>
        )
    },
)

CompareRunColumnContent.displayName = "CompareRunColumnContent"

const CompareMetaRow = memo(
    ({
        compareScenarios,
        columnMinWidth,
        registerScrollContainer,
        onScrollSync,
    }: {
        compareScenarios: {
            runId: string | null
            scenarioId: string | null
            compareIndex: number
        }[]
        columnMinWidth: number
        registerScrollContainer: (node: HTMLDivElement | null) => void
        onScrollSync: (node: HTMLDivElement) => void
    }) => {
        const scrollRef = useRef<HTMLDivElement | null>(null)
        const columnsCount = compareScenarios.length
        const rowGridStyle = useMemo(
            () => ({
                gridTemplateColumns: `repeat(${columnsCount}, ${columnMinWidth}px)`,
                minWidth: `${columnsCount * columnMinWidth}px`,
            }),
            [columnsCount, columnMinWidth],
        )
        const handleScroll = useCallback(() => {
            if (scrollRef.current) {
                onScrollSync(scrollRef.current)
            }
        }, [onScrollSync])

        return (
            <SectionCard className="!p-0">
                <div
                    ref={(node) => {
                        scrollRef.current = node
                        registerScrollContainer(node)
                    }}
                    className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    onScroll={handleScroll}
                >
                    <div className="grid gap-4" style={rowGridStyle}>
                        {compareScenarios.map(({runId, scenarioId, compareIndex}) => {
                            if (!runId || !scenarioId) {
                                return (
                                    <div
                                        key={`meta-empty-${compareIndex}`}
                                        className="min-w-[480px] flex items-center justify-center p-3 bg-gray-50 rounded-lg"
                                    >
                                        <Text type="secondary">—</Text>
                                    </div>
                                )
                            }

                            return (
                                <EvalOutputMetaRow
                                    key={`meta-${runId}`}
                                    runId={runId}
                                    scenarioId={scenarioId}
                                    compareIndex={compareIndex}
                                />
                            )
                        })}
                    </div>
                </div>
            </SectionCard>
        )
    },
)

CompareMetaRow.displayName = "CompareMetaRow"

/**
 * A single compare section rendered as a collapsible row, aligned to shared columns.
 */
const CompareSectionRow = memo(
    ({
        sectionId,
        sectionLabel,
        sectionGroup,
        compareScenarios,
        sectionMapsPerRun,
        columnMinWidth,
        registerScrollContainer,
        onScrollSync,
    }: {
        sectionId: string
        sectionLabel: string
        sectionGroup: EvaluationTableColumnGroup | null
        compareScenarios: {
            runId: string | null
            scenarioId: string | null
            compareIndex: number
        }[]
        sectionMapsPerRun: Map<string, FocusDrawerSection>[]
        columnMinWidth: number
        registerScrollContainer: (node: HTMLDivElement | null) => void
        onScrollSync: (node: HTMLDivElement) => void
    }) => {
        const [collapsed, setCollapsed] = useState(false)
        const scrollRef = useRef<HTMLDivElement | null>(null)
        const firstSection = sectionMapsPerRun.find((map) => map.get(sectionId))?.get(sectionId)
        const sectionLabelNode = (
            <>
                {sectionGroup && firstSection ? (
                    <FocusGroupLabel
                        group={sectionGroup}
                        label={sectionLabel}
                        runId={compareScenarios[0]?.runId ?? ""}
                    />
                ) : (
                    sectionLabel
                )}
            </>
        )
        const columnsCount = compareScenarios.length
        const rowGridStyle = useMemo(
            () => ({
                gridTemplateColumns: `repeat(${columnsCount}, ${columnMinWidth}px)`,
                minWidth: `${columnsCount * columnMinWidth}px`,
            }),
            [columnsCount, columnMinWidth],
        )
        const handleScroll = useCallback(() => {
            if (scrollRef.current) {
                onScrollSync(scrollRef.current)
            }
        }, [onScrollSync])
        return (
            <div id={toSectionAnchorId(sectionId)} className="flex flex-col">
                <FocusSectionHeader
                    title={sectionLabelNode}
                    collapsed={collapsed}
                    onToggle={() => setCollapsed((value) => !value)}
                />
                {!collapsed ? (
                    <div
                        ref={(node) => {
                            scrollRef.current = node
                            registerScrollContainer(node)
                        }}
                        className="overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        onScroll={handleScroll}
                    >
                        <div className="grid gap-4" style={rowGridStyle}>
                            {compareScenarios.map(({runId, scenarioId, compareIndex}) => {
                                const section = sectionMapsPerRun[compareIndex]?.get(sectionId)

                                if (!runId || !scenarioId || !section) {
                                    return (
                                        <div
                                            key={`empty-${compareIndex}`}
                                            className="min-w-[480px] flex items-center justify-center p-4 bg-gray-50 rounded-lg"
                                        >
                                            <Text type="secondary">—</Text>
                                        </div>
                                    )
                                }

                                return (
                                    <CompareRunColumnContent
                                        key={`${runId}-${sectionId}`}
                                        runId={runId}
                                        scenarioId={scenarioId}
                                        section={section}
                                    />
                                )
                            })}
                        </div>
                    </div>
                ) : null}
            </div>
        )
    },
)

CompareSectionRow.displayName = "CompareSectionRow"

/**
 * Inner component that handles the section data fetching for compare mode
 * This allows us to use hooks properly for each run
 */
const FocusDrawerCompareContentInner = ({
    compareScenarios,
}: {
    compareScenarios: {
        runId: string | null
        scenarioId: string | null
        compareIndex: number
    }[]
}) => {
    // Get sections for base run (index 0)
    const baseRunId = compareScenarios[0]?.runId ?? null
    const {sections: baseSections} = useFocusDrawerSections(baseRunId)

    // Get sections for comparison run 1 (index 1)
    const compare1RunId = compareScenarios[1]?.runId ?? null
    const {sections: compare1Sections} = useFocusDrawerSections(compare1RunId)

    // Get sections for comparison run 2 (index 2)
    const compare2RunId = compareScenarios[2]?.runId ?? null
    const {sections: compare2Sections} = useFocusDrawerSections(compare2RunId)

    // Collect all sections per run
    const sectionsPerRun = useMemo(() => {
        const result: FocusDrawerSection[][] = [baseSections]
        if (compareScenarios.length > 1) result.push(compare1Sections)
        if (compareScenarios.length > 2) result.push(compare2Sections)
        return result
    }, [baseSections, compare1Sections, compare2Sections, compareScenarios.length])

    // Normalize section key for matching across runs
    // Use group.kind for invocation/input sections (which have run-specific IDs)
    // Use section.id for other stable sections
    const getNormalizedSectionKey = (section: FocusDrawerSection): string => {
        const kind = section.group?.kind
        if (kind === "invocation" || kind === "input") {
            return kind
        }
        return section.id
    }

    // Collect all unique normalized section keys in order with their labels and groups
    const allSections = useMemo(() => {
        const seen = new Set<string>()
        const sections: {
            normalizedKey: string
            label: string
            group: EvaluationTableColumnGroup | null
        }[] = []
        sectionsPerRun.forEach((runSections) => {
            runSections.forEach((section) => {
                const normalizedKey = getNormalizedSectionKey(section)
                if (!seen.has(normalizedKey)) {
                    seen.add(normalizedKey)
                    sections.push({normalizedKey, label: section.label, group: section.group})
                }
            })
        })
        return sections
    }, [sectionsPerRun])

    // Create a map of normalizedKey -> section for each run
    const sectionMapsPerRun = useMemo(() => {
        return sectionsPerRun.map((sections) => {
            const map = new Map<string, FocusDrawerSection>()
            sections.forEach((section) => {
                const normalizedKey = getNormalizedSectionKey(section)
                map.set(normalizedKey, section)
            })
            return map
        })
    }, [sectionsPerRun])

    const inputSectionEntry = useMemo(() => {
        for (let index = 0; index < sectionMapsPerRun.length; index += 1) {
            const section = sectionMapsPerRun[index]?.get("input")
            const runId = compareScenarios[index]?.runId ?? null
            const scenarioId = compareScenarios[index]?.scenarioId ?? null
            if (section && runId && scenarioId) {
                return {section, runId, scenarioId}
            }
        }
        return null
    }, [compareScenarios, sectionMapsPerRun])

    const compareSections = useMemo(
        () =>
            allSections.filter(
                (section) =>
                    section.normalizedKey !== "input" && section.normalizedKey !== "invocation",
            ),
        [allSections],
    )
    const invocationSectionEntry = useMemo(
        () => allSections.find((section) => section.normalizedKey === "invocation") ?? null,
        [allSections],
    )

    const compareColumnMinWidth = 480
    const scrollContainersRef = useRef<HTMLDivElement[]>([])
    const isSyncingRef = useRef(false)
    const registerScrollContainer = useCallback((node: HTMLDivElement | null) => {
        if (!node) return
        const list = scrollContainersRef.current
        if (list.includes(node)) return
        list.push(node)
    }, [])
    const onScrollSync = useCallback((source: HTMLDivElement) => {
        if (isSyncingRef.current) return
        isSyncingRef.current = true
        const left = source.scrollLeft
        scrollContainersRef.current.forEach((node) => {
            if (node !== source && node.scrollLeft !== left) {
                node.scrollLeft = left
            }
        })
        isSyncingRef.current = false
    }, [])

    return (
        <div className="flex flex-col pb-6">
            {inputSectionEntry ? (
                <FocusDrawerSectionCard
                    section={inputSectionEntry.section}
                    runId={inputSectionEntry.runId}
                    scenarioId={inputSectionEntry.scenarioId}
                />
            ) : null}
            <div className="flex flex-col">
                {invocationSectionEntry ? (
                    <CompareMetaRow
                        compareScenarios={compareScenarios}
                        columnMinWidth={compareColumnMinWidth}
                        registerScrollContainer={registerScrollContainer}
                        onScrollSync={onScrollSync}
                    />
                ) : null}
                {invocationSectionEntry ? (
                    <CompareSectionRow
                        sectionId={invocationSectionEntry.normalizedKey}
                        sectionLabel={invocationSectionEntry.label}
                        sectionGroup={invocationSectionEntry.group}
                        compareScenarios={compareScenarios}
                        sectionMapsPerRun={sectionMapsPerRun}
                        columnMinWidth={compareColumnMinWidth}
                        registerScrollContainer={registerScrollContainer}
                        onScrollSync={onScrollSync}
                    />
                ) : null}
                {compareSections.map(({normalizedKey, label, group}) => (
                    <CompareSectionRow
                        key={normalizedKey}
                        sectionId={normalizedKey}
                        sectionLabel={label}
                        sectionGroup={group}
                        compareScenarios={compareScenarios}
                        sectionMapsPerRun={sectionMapsPerRun}
                        columnMinWidth={compareColumnMinWidth}
                        registerScrollContainer={registerScrollContainer}
                        onScrollSync={onScrollSync}
                    />
                ))}
            </div>
        </div>
    )
}

/**
 * Comparison mode content - single column layout with sections containing multiple run columns
 */
const FocusDrawerCompareContent = () => {
    const compareScenarios = useAtomValue(compareScenarioMatchesAtom)

    if (!compareScenarios.length) {
        return (
            <div className="p-6">
                <Text type="secondary">No comparison scenarios found</Text>
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-zinc-1 overflow-y-auto">
            <FocusDrawerCompareContentInner compareScenarios={compareScenarios} />
        </div>
    )
}

export const FocusDrawerContent = ({
    runId,
    scenarioId,
    disableScroll = false,
}: FocusDrawerContentProps) => {
    const {columnResult} = usePreviewTableData({runId})
    const descriptorMap = useAtomValue(
        useMemo(() => columnValueDescriptorMapAtomFamily(runId ?? null), [runId]),
    )
    const runIndex = useAtomValue(
        useMemo(() => evaluationRunIndexAtomFamily(runId ?? null), [runId]),
    )

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
                if (group.kind === "metric") {
                    return null
                }

                const sectionLabel = group.label

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
                    group,
                }
            })
            .filter((section): section is FocusDrawerSection => Boolean(section))
    }, [columnMap, descriptorMap, groups, runIndex])

    if (!columnResult) {
        return <Skeleton active paragraph={{rows: 6}} />
    }

    return (
        <div
            className={clsx(
                "flex flex-col min-h-0 px-2 pb-6 bg-zinc-1",
                disableScroll ? "" : "h-full overflow-y-auto",
            )}
            data-focus-drawer-content
        >
            {sections.map((section) => {
                if (section.group?.kind === "invocation") {
                    return (
                        <div key={section.id} className="flex flex-col">
                            <SectionCard className="!p-0">
                                <EvalOutputMetaRow runId={runId} scenarioId={scenarioId} />
                            </SectionCard>
                            <FocusDrawerSectionCard
                                section={section}
                                runId={runId}
                                scenarioId={scenarioId}
                            />
                        </div>
                    )
                }
                return (
                    <FocusDrawerSectionCard
                        key={section.id}
                        section={section}
                        runId={runId}
                        scenarioId={scenarioId}
                    />
                )
            })}
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
    const isCompareMode = focus?.compareMode ?? false

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    const handleAfterOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                resetDrawer()
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
            closeOnLayoutClick={false}
            expandable
            className="[&_.ant-drawer-body]:p-0 [&_.ant-drawer-header]:p-4"
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
                    isCompareMode ? (
                        <FocusDrawerCompareContent />
                    ) : (
                        <FocusDrawerContent runId={focusRunId} scenarioId={focusScenarioId} />
                    )
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
