import {useCallback, useMemo} from "react"

import {Typography} from "antd"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    type ColumnVisibilityState,
    type ColumnTreeNode,
} from "@/oss/components/InfiniteVirtualTable"
import ColumnVisibilityPopoverContentBase, {
    type ColumnVisibilityNodeMeta,
} from "@/oss/components/InfiniteVirtualTable/components/columnVisibility/ColumnVisibilityPopoverContent"
import {
    getEvaluatorMetricBlueprintAtom,
    type EvaluatorMetricGroupBlueprint,
} from "@/oss/components/References/atoms/metricBlueprint"
import {resolvedMetricLabelsAtomFamily} from "@/oss/components/References/atoms/resolvedMetricLabels"
import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"

import {evaluationRunsColumnVisibilityContextAtom} from "../../atoms/view"
import type {EvaluationRunTableRow} from "../../types"
import type {RunMetricDescriptor} from "../../types/runMetrics"
import MetricGroupHeader from "../headers/MetricGroupHeader"

interface ColumnVisibilityPopoverContentProps {
    onClose: () => void
    controls?: ColumnVisibilityState<EvaluationRunTableRow>
    onExport?: () => void
    isExporting?: boolean
}

const ColumnVisibilityPopoverContent = ({
    onClose,
    controls,
    onExport,
    isExporting,
}: ColumnVisibilityPopoverContentProps) => {
    const columnContext = useAtomValueWithSchedule(evaluationRunsColumnVisibilityContextAtom, {
        priority: LOW_PRIORITY,
    })
    const blueprintAtom = useMemo(
        () => getEvaluatorMetricBlueprintAtom(columnContext.scopeId),
        [columnContext.scopeId],
    )
    const evaluatorBlueprint = useAtomValueWithSchedule(blueprintAtom, {
        priority: LOW_PRIORITY,
    })

    const {groupMap, descriptorMap} = useMemo(() => {
        const groups = new Map<string, EvaluatorMetricGroupBlueprint>()
        const descriptors = new Map<
            string,
            {descriptor: RunMetricDescriptor; group?: EvaluatorMetricGroupBlueprint}
        >()

        evaluatorBlueprint.forEach((group) => {
            groups.set(group.id, group)
            group.columns.forEach((descriptor) => {
                descriptors.set(descriptor.id, {descriptor, group})
            })
        })

        return {groupMap: groups, descriptorMap: descriptors}
    }, [evaluatorBlueprint])

    const resolveNodeMeta = useCallback(
        (node: ColumnTreeNode): ColumnVisibilityNodeMeta => {
            const hasChildren = Boolean(node.children?.length)
            const key = String(node.key)
            const groupId = key.startsWith("group:") ? key.replace(/^group:/, "") : null
            const blueprintGroup = groupId ? groupMap.get(groupId) : undefined
            const descriptorEntry = descriptorMap.get(key)

            const searchValues: string[] = []
            let title: React.ReactNode | undefined

            if (blueprintGroup && groupId !== "invocation") {
                const fallback = blueprintGroup.label || node.label || key || blueprintGroup.id
                searchValues.push(
                    blueprintGroup.label ?? "",
                    blueprintGroup.id ?? "",
                    fallback ?? "",
                )
                title = (
                    <MetricGroupHeader
                        slug={blueprintGroup.handles?.slug ?? blueprintGroup.id}
                        evaluatorId={
                            blueprintGroup.handles?.id ?? blueprintGroup.evaluatorId ?? null
                        }
                        fallbackLabel={fallback ?? ""}
                        columnKey={groupId}
                        projectId={blueprintGroup.projectId ?? columnContext.projectId}
                    />
                )
            } else if (groupId === "invocation") {
                const fallback = "Invocation"
                searchValues.push("Invocation", node.label ?? "", key)
                title = <DefaultNodeLabel label={fallback} emphasize />
            } else if (descriptorEntry) {
                const descriptorLabel =
                    descriptorEntry.descriptor.label ??
                    descriptorEntry.descriptor.metricPath ??
                    node.label ??
                    key
                searchValues.push(
                    descriptorLabel,
                    descriptorEntry.descriptor.metricPath ?? "",
                    descriptorEntry.descriptor.metricKey ?? "",
                    descriptorEntry.group?.label ?? "",
                )
                title = (
                    <MetricColumnLabel
                        descriptor={descriptorEntry.descriptor}
                        fallbackLabel={descriptorLabel ?? key}
                        groupLabel={descriptorEntry.group?.label}
                    />
                )
            } else {
                const fallback = node.label ?? key
                searchValues.push(fallback ?? "")
                title = <DefaultNodeLabel label={fallback ?? key} emphasize={hasChildren} />
            }

            return {
                title,
                searchValues,
            }
        },
        [columnContext.projectId, descriptorMap, groupMap],
    )

    return (
        <ColumnVisibilityPopoverContentBase
            onClose={onClose}
            controls={controls}
            scopeId={columnContext.scopeId}
            resolveNodeMeta={resolveNodeMeta}
            onExport={onExport}
            isExporting={isExporting}
        />
    )
}

export default ColumnVisibilityPopoverContent

const OUTPUT_METRIC_PATH_PREFIX = /^attributes\.ag\.data\.outputs\.?/i

const stripOutputsNamespace = (value?: string | null) => {
    if (!value) return null
    const stripped = value.replace(OUTPUT_METRIC_PATH_PREFIX, "")
    return stripped.length ? stripped : "output"
}

const MetricColumnLabel = ({
    descriptor,
    fallbackLabel,
    groupLabel,
}: {
    descriptor: RunMetricDescriptor
    fallbackLabel: string
    groupLabel?: string
}) => {
    const resolvedLabelAtom = useMemo(
        () => resolvedMetricLabelsAtomFamily(descriptor.id),
        [descriptor.id],
    )
    const resolvedLabel = useAtomValueWithSchedule(resolvedLabelAtom, {
        priority: LOW_PRIORITY,
    })
    const normalizedMetric = useMemo(() => {
        const metric =
            descriptor.metricPath ?? descriptor.metricKey ?? fallbackLabel ?? descriptor.id ?? ""
        return stripOutputsNamespace(metric) ?? metric
    }, [descriptor.id, descriptor.metricKey, descriptor.metricPath, fallbackLabel])
    const primaryLabel =
        (typeof resolvedLabel === "string" && resolvedLabel.trim().length ? resolvedLabel : null) ??
        descriptor.label ??
        humanizeMetricPath(normalizedMetric) ??
        fallbackLabel

    return (
        <div className="flex flex-col leading-tight">
            <Typography.Text ellipsis>{primaryLabel}</Typography.Text>
            {groupLabel ? (
                <Typography.Text type="secondary" className="text-xs" ellipsis>
                    {groupLabel}
                </Typography.Text>
            ) : null}
        </div>
    )
}

const DefaultNodeLabel = ({label, emphasize}: {label: string; emphasize?: boolean}) => (
    <Typography.Text className={emphasize ? "font-semibold" : ""} ellipsis>
        {label}
    </Typography.Text>
)
