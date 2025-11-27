import {useMemo, useCallback} from "react"

import {Typography} from "antd"

import type {ColumnTreeNode, ColumnVisibilityState} from "@/oss/components/InfiniteVirtualTable"
import ColumnVisibilityPopoverContentBase, {
    type ColumnVisibilityNodeMeta,
} from "@/oss/components/InfiniteVirtualTable/components/columnVisibility/ColumnVisibilityPopoverContent"
import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"

import {
    type EvaluationTableColumn,
    type EvaluationTableColumnGroup,
    type EvaluationTableColumnsResult,
    type MetricColumnDefinition,
} from "../../atoms/table"
import {evaluationTypeFromKind} from "../../components/views/OverviewView/utils/metrics"
import usePreviewTableData from "../../hooks/usePreviewTableData"
import {buildSkeletonColumnResult} from "../../utils/buildSkeletonColumns"
import {
    humanizeIdentifier,
    titleize,
    formatReferenceLabel,
    humanizeStepKey,
} from "../../utils/labelHelpers"
import StepGroupHeader from "../TableHeaders/StepGroupHeader"

type EvaluationType = "auto" | "human"

interface ScenarioColumnVisibilityPopoverContentProps {
    runId: string
    evaluationType: EvaluationType
    controls?: ColumnVisibilityState<any>
    onClose: () => void
    scopeId?: string | null
}

const selectColumnsForType = (
    result: EvaluationTableColumnsResult | undefined,
    evaluationType: EvaluationType,
) => {
    if (
        !result ||
        result.groups.length === 0 ||
        result.columns.every((column) => column.kind === "meta")
    ) {
        return buildSkeletonColumnResult(evaluationType)
    }

    const relevantGroups = result.groups.filter((group) => {
        if (group.kind !== "metric") return true
        return evaluationType === "auto"
            ? group.id.includes("metrics:auto")
            : group.id.includes("metrics:human")
    })

    const staticMetrics =
        evaluationType === "auto"
            ? {auto: result.staticMetricColumns.auto, human: [] as MetricColumnDefinition[]}
            : {auto: [] as MetricColumnDefinition[], human: result.staticMetricColumns.human}

    return {
        columns: result.columns,
        groups: relevantGroups,
        ungroupedColumns: result.ungroupedColumns,
        staticMetricColumns: staticMetrics,
        evaluators: result.evaluators,
    }
}

const OUTPUT_METRIC_PATH_PREFIX = /^attributes\.ag\.data\.outputs\.?/i

function stripOutputsNamespace(value?: string | null) {
    if (!value) return null
    const stripped = value.replace(OUTPUT_METRIC_PATH_PREFIX, "")
    return stripped.length ? stripped : "output"
}

function normalizeMetricLabel(metricKey?: string | null) {
    if (!metricKey) return undefined
    const normalized = stripOutputsNamespace(metricKey) ?? metricKey
    if (!normalized) return undefined
    return humanizeMetricPath(normalized) || normalized
}

function resolveGroupLabel(group: EvaluationTableColumnGroup) {
    const meta = group.meta ?? {}
    const refs = (meta.refs ?? {}) as Record<string, any>
    const stepRole = (meta.stepRole as string | undefined) ?? (group.kind as string | undefined)

    if (stepRole === "input") {
        const testsetName =
            humanizeIdentifier(refs.testset?.name) ??
            humanizeIdentifier(refs.testset?.slug) ??
            formatReferenceLabel(refs.testset)
        if (testsetName) {
            return `Testset ${testsetName}`
        }

        const queryLabel =
            formatReferenceLabel(refs.query) ?? formatReferenceLabel(refs.query_revision)
        if (queryLabel) {
            return `Query ${queryLabel}`
        }
    }

    if (stepRole === "invocation") {
        const applicationLabel =
            humanizeIdentifier(refs.application?.name) ??
            humanizeIdentifier(refs.application?.slug) ??
            formatReferenceLabel(refs.application) ??
            formatReferenceLabel(refs.agent) ??
            formatReferenceLabel(refs.tool)
        const variantLabel =
            humanizeIdentifier(refs.application_variant?.name) ??
            humanizeIdentifier(refs.variant?.name) ??
            formatReferenceLabel(refs.application_variant) ??
            formatReferenceLabel(refs.variant)

        const revisionVersion =
            refs.application_revision?.version ?? refs.application_revision?.revision ?? null

        const parts = []
        if (applicationLabel) parts.push(`Application ${applicationLabel}`)
        if (variantLabel && variantLabel !== applicationLabel) parts.push(`Variant ${variantLabel}`)
        if (revisionVersion) parts.push(`Rev ${revisionVersion}`)
        if (parts.length) return parts.join(" · ")
    }

    return null
}

const ScenarioColumnVisibilityPopoverContent = ({
    runId,
    evaluationType,
    controls,
    onClose,
    scopeId,
}: ScenarioColumnVisibilityPopoverContentProps) => {
    const {columnResult} = usePreviewTableData({runId})

    const columnData = useMemo(
        () => selectColumnsForType(columnResult, evaluationTypeFromKind(evaluationType)),
        [columnResult, evaluationType],
    )

    const visibilityColumnMap = useMemo(() => {
        const map = new Map<string, EvaluationTableColumn>()
        columnData.columns.forEach((column) => {
            map.set(column.id, column)
        })
        return map
    }, [columnData.columns])

    const visibilityGroupMap = useMemo(() => {
        const map = new Map<string, EvaluationTableColumnGroup>()
        columnData.groups.forEach((group) => {
            map.set(group.id, group)
        })
        return map
    }, [columnData.groups])

    const visibilityStaticMetricMap = useMemo(() => {
        const map = new Map<
            string,
            {metric: MetricColumnDefinition; group?: EvaluationTableColumnGroup}
        >()
        const metricsForType =
            evaluationType === "auto"
                ? columnData.staticMetricColumns.auto
                : columnData.staticMetricColumns.human

        if (!metricsForType.length) return map

        columnData.groups
            .filter((group) => group.kind === "metric")
            .forEach((group) => {
                metricsForType.forEach((metric) => {
                    map.set(`${group.id}::${metric.path}`, {metric, group})
                })
            })

        return map
    }, [columnData.groups, columnData.staticMetricColumns, evaluationType])

    const resolveNodeMeta = useCallback(
        (node: ColumnTreeNode): ColumnVisibilityNodeMeta => {
            const key = String(node.key)

            const group = visibilityGroupMap.get(key)
            if (group) {
                const label =
                    resolveGroupLabel(group) ??
                    group.label ??
                    node.label ??
                    humanizeStepKey(group.id, group.kind)
                const groupTitle =
                    group.kind === "input" || group.kind === "invocation" ? (
                        <StepGroupHeader group={group} fallbackLabel={label ?? key} />
                    ) : (
                        <VisibilityNodeTitle label={label ?? key} emphasize />
                    )
                return {
                    title: groupTitle,
                    searchValues: [label ?? "", group.id, group.kind],
                }
            }

            const column = visibilityColumnMap.get(key)
            if (column) {
                const groupLabel = column.groupId
                    ? visibilityGroupMap.get(column.groupId)?.label
                    : undefined
                const label =
                    column.displayLabel ??
                    column.label ??
                    (column.metricKey ? normalizeMetricLabel(column.metricKey) : undefined) ??
                    node.label ??
                    key

                return {
                    title: <VisibilityNodeTitle label={label ?? key} emphasize={!groupLabel} />,
                    searchValues: [
                        label ?? "",
                        column.label,
                        column.displayLabel,
                        column.metricKey,
                        column.path,
                        column.stepKey,
                        groupLabel,
                        key,
                    ],
                }
            }

            const staticMetric = visibilityStaticMetricMap.get(key)
            if (staticMetric) {
                const metricLabel =
                    staticMetric.metric.displayLabel ??
                    normalizeMetricLabel(staticMetric.metric.path) ??
                    titleize(staticMetric.metric.name) ??
                    staticMetric.metric.name ??
                    key
                const groupLabel = staticMetric.group?.label ?? staticMetric.group?.id
                return {
                    title: (
                        <VisibilityNodeTitle
                            label={metricLabel}
                            secondary={groupLabel}
                            emphasize={!groupLabel}
                        />
                    ),
                    searchValues: [
                        metricLabel,
                        staticMetric.metric.path,
                        staticMetric.metric.name,
                        groupLabel,
                        key,
                    ],
                }
            }

            const fallback =
                node.label ?? (typeof node.titleNode === "string" ? node.titleNode : null)
            return {
                title: (
                    <VisibilityNodeTitle
                        label={fallback ?? key}
                        emphasize={Boolean(node.children?.length)}
                    />
                ),
                searchValues: [fallback ?? "", key],
            }
        },
        [visibilityColumnMap, visibilityGroupMap, visibilityStaticMetricMap],
    )

    return (
        <ColumnVisibilityPopoverContentBase
            onClose={onClose}
            controls={controls}
            scopeId={scopeId ?? runId}
            resolveNodeMeta={resolveNodeMeta}
        />
    )
}

const VisibilityNodeTitle = ({
    label,
    secondary,
    emphasize,
}: {
    label: string
    secondary?: string | null
    emphasize?: boolean
}) => (
    <div className="flex flex-col leading-tight">
        <Typography.Text className={emphasize ? "font-semibold text-sm" : "text-sm"} ellipsis>
            {label}
        </Typography.Text>
        {secondary ? (
            <Typography.Text type="secondary" className="text-xs" ellipsis>
                {secondary}
            </Typography.Text>
        ) : null}
    </div>
)

export default ScenarioColumnVisibilityPopoverContent
