import {memo, useCallback, useMemo} from "react"
import {isValidElement} from "react"

import {Popover, Skeleton, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {AlertCircle} from "lucide-react"

import {previewRunMetricStatsSelectorFamily} from "@/oss/components/Evaluations/atoms/runMetrics"
import MetricDetailsPreviewPopover from "@/oss/components/Evaluations/components/MetricDetailsPreviewPopover"
import GenericDrawer from "@/oss/components/GenericDrawer"
import {VariantReferenceChip, TestsetChipList} from "@/oss/components/References"

import ReadOnlyBox from "../../pages/evaluations/onlineEvaluation/components/ReadOnlyBox"
import {getComparisonSolidColor} from "../atoms/compare"
import {
    applicationReferenceQueryAtomFamily,
    testsetReferenceQueryAtomFamily,
    variantReferenceQueryAtomFamily,
} from "../atoms/references"
import {effectiveProjectIdAtom} from "../atoms/run"
import {runDisplayNameAtomFamily} from "../atoms/runDerived"
import {runInvocationRefsAtomFamily, runTestsetIdsAtomFamily} from "../atoms/runDerived"
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
import type {CompareScenarioInfo} from "../state/focusDrawerAtom"
import {clearFocusDrawerQueryParams} from "../state/urlFocusDrawer"
import {renderScenarioChatMessages} from "../utils/chatMessages"
import {formatMetricDisplay, METRIC_EMPTY_PLACEHOLDER} from "../utils/metricFormatter"

import FocusDrawerHeader from "./FocusDrawerHeader"
import FocusDrawerSidePanel from "./FocusDrawerSidePanel"

const SECTION_CARD_CLASS = "rounded-xl border border-[#EAECF0] bg-white"

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
    const {applicationId, applicationVariantId, variantRevision} = useInvocationRefs(group, runId)

    const appQuery = useAtomValue(
        useMemo(() => applicationReferenceQueryAtomFamily(applicationId ?? null), [applicationId]),
    )
    const testsetQuery = useAtomValue(
        useMemo(() => testsetReferenceQueryAtomFamily(testsetId ?? null), [testsetId]),
    )
    const variantQuery = useAtomValue(
        useMemo(
            () => variantReferenceQueryAtomFamily(applicationVariantId ?? null),
            [applicationVariantId],
        ),
    )

    if (group?.kind === "input" && testsetId && testsetQuery.data?.name) {
        return <>{`Testset ${testsetQuery.data.name}`}</>
    }

    if (group?.kind === "invocation") {
        const applicationLabel =
            appQuery.data?.name ?? appQuery.data?.slug ?? appQuery.data?.id ?? applicationId ?? null

        if (applicationLabel) return <>{`Application ${applicationLabel}`}</>
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

            if (
                typeof resolvedValue === "string" ||
                typeof resolvedValue === "number" ||
                typeof resolvedValue === "boolean"
            ) {
                return <Text>{String(resolvedValue)}</Text>
            }

            try {
                return (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[#1D2939]">
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
            <div className="flex flex-col gap-1 px-4 pb-1">
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
        compareIndex,
    }: {
        runId: string
        scenarioId: string
        section: FocusDrawerSection
        compareIndex: number
    }) => {
        const runDisplayNameAtom = useMemo(() => runDisplayNameAtomFamily(runId), [runId])
        const runDisplayName = useAtomValue(runDisplayNameAtom)

        return (
            <div className="flex-1 min-w-[280px] shrink-0 flex flex-col gap-3">
                {/* Run header with color indicator */}
                <div className="flex items-center gap-2 pb-2 border-b border-[#EAECF0]">
                    <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{backgroundColor: getComparisonSolidColor(compareIndex)}}
                    />
                    <Text strong className="text-sm truncate">
                        {runDisplayName ||
                            (compareIndex === 0 ? "Base Run" : `Comparison ${compareIndex}`)}
                    </Text>
                </div>

                {/* Invocation meta chips if applicable */}
                {section.group?.kind === "invocation" ? (
                    <InvocationMetaChips group={section.group} runId={runId} />
                ) : null}

                {/* Column values */}
                <div className="flex flex-col gap-3">
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
            </div>
        )
    },
)

CompareRunColumnContent.displayName = "CompareRunColumnContent"

/**
 * A single section card containing all runs side-by-side
 */
const CompareSectionCard = memo(
    ({
        sectionId,
        sectionLabel,
        sectionGroup,
        compareScenarios,
        sectionMapsPerRun,
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
    }) => {
        // Get the first available section for the label
        const firstSection = sectionMapsPerRun.find((map) => map.get(sectionId))?.get(sectionId)

        return (
            <section className={`${SECTION_CARD_CLASS} flex flex-col`}>
                {/* Section header */}
                <div className="border-b border-[#EAECF0] px-4 py-3">
                    <Title level={5} className="!mb-0 text-[#1D2939]">
                        {sectionGroup && firstSection ? (
                            <FocusGroupLabel
                                group={sectionGroup}
                                label={sectionLabel}
                                runId={compareScenarios[0]?.runId ?? ""}
                            />
                        ) : (
                            sectionLabel
                        )}
                    </Title>
                </div>

                {/* Run columns side by side */}
                <div className="flex gap-4 p-4 overflow-x-auto">
                    {compareScenarios.map(({runId, scenarioId, compareIndex}) => {
                        const section = sectionMapsPerRun[compareIndex]?.get(sectionId)

                        if (!runId || !scenarioId || !section) {
                            return (
                                <div
                                    key={`empty-${compareIndex}`}
                                    className="flex-1 min-w-[280px] shrink-0 flex items-center justify-center p-4 bg-gray-50 rounded-lg"
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
                                compareIndex={compareIndex}
                            />
                        )
                    })}
                </div>
            </section>
        )
    },
)

CompareSectionCard.displayName = "CompareSectionCard"

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
    // Use section.id for metric sections (which have stable IDs like "metrics:auto")
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

    return (
        <div className="flex flex-col gap-4 p-4 overflow-auto h-full">
            {allSections.map(({normalizedKey, label, group}) => (
                <CompareSectionCard
                    key={normalizedKey}
                    sectionId={normalizedKey}
                    sectionLabel={label}
                    sectionGroup={group}
                    compareScenarios={compareScenarios}
                    sectionMapsPerRun={sectionMapsPerRun}
                />
            ))}
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
        <div className="flex flex-col h-full bg-[#F8FAFC]">
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
            className={`flex flex-col gap-4 bg-[#F8FAFC] p-4 ${disableScroll ? "" : "h-full overflow-auto"}`}
            data-focus-drawer-content
        >
            {sections.map((section) => (
                <section
                    key={section.id}
                    id={section.anchorId}
                    className={`${SECTION_CARD_CLASS} flex flex-col gap-3`}
                >
                    <div className="border-b border-[#EAECF0] px-4 py-3">
                        <Title level={5} className="!mb-0 text-[#1D2939]">
                            <FocusGroupLabel
                                group={section.group}
                                label={section.label}
                                runId={runId}
                            />
                        </Title>
                    </div>
                    {section.group?.kind === "invocation" ? (
                        <InvocationMetaChips group={section.group} runId={runId} />
                    ) : null}
                    <div className="flex flex-col gap-3 px-4 pb-4">
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
                </section>
            ))}
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
