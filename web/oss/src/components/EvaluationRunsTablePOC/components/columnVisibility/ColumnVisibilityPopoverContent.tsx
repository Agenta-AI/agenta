import {useCallback, useMemo} from "react"

import {Typography} from "antd"
import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"
import {
    type ColumnVisibilityState,
    type ColumnTreeNode,
} from "@/oss/components/InfiniteVirtualTable"
import ColumnVisibilityPopoverContentBase, {
    type ColumnVisibilityNodeMeta,
} from "@/oss/components/InfiniteVirtualTable/components/columnVisibility/ColumnVisibilityPopoverContent"
import {evaluatorReferenceAtomFamily} from "@/oss/components/References/atoms/entityReferences"
import {
    getEvaluatorMetricBlueprintAtom,
    type EvaluatorMetricGroupBlueprint,
} from "@/oss/components/References/atoms/metricBlueprint"
import {resolvedMetricLabelsAtomFamily} from "@/oss/components/References/atoms/resolvedMetricLabels"

import {evaluationRunsColumnVisibilityContextAtom} from "../../atoms/view"
import type {EvaluationRunTableRow} from "../../types"
import type {RunMetricDescriptor} from "../../types/runMetrics"
import MetricGroupHeader from "../headers/MetricGroupHeader"

interface ColumnVisibilityPopoverContentProps {
    onClose: () => void
    controls?: ColumnVisibilityState<EvaluationRunTableRow>
}

const ColumnVisibilityPopoverContent = ({
    onClose,
    controls,
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
        />
    )
}

export default ColumnVisibilityPopoverContent

const nullEvaluatorReferenceAtom = atom(null)

const OUTPUT_METRIC_PATH_PREFIX = /^attributes\.ag\.data\.outputs\.?/i

const stripOutputsNamespace = (value?: string | null) => {
    if (!value) return null
    const stripped = value.replace(OUTPUT_METRIC_PATH_PREFIX, "")
    return stripped.length ? stripped : "output"
}

const MetricGroupLabel = ({
    group,
    fallbackLabel,
    projectId,
}: {
    group: EvaluatorMetricGroupBlueprint
    fallbackLabel: string
    projectId: string | null
}) => {
    const primaryDescriptor = group.columns[0]
    const slug = primaryDescriptor?.evaluatorRef?.slug ?? group.id ?? null
    const evaluatorId = primaryDescriptor?.evaluatorRef?.id ?? group.referenceId ?? null

    const referenceAtom = useMemo(() => {
        if (!projectId || (!slug && !evaluatorId)) {
            return nullEvaluatorReferenceAtom
        }
        return evaluatorReferenceAtomFamily({
            projectId,
            slug: slug ?? undefined,
            id: evaluatorId ?? undefined,
        })
    }, [evaluatorId, projectId, slug])

    const evaluatorReference = useAtomValueWithSchedule(referenceAtom, {
        priority: LOW_PRIORITY,
    })?.data
    const label =
        evaluatorReference?.name ??
        group.label ??
        fallbackLabel ??
        evaluatorReference?.slug ??
        slug ??
        "Evaluator"

    return (
        <Typography.Text className="font-semibold text-sm" ellipsis>
            {label}
        </Typography.Text>
    )
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
            <Typography.Text className="text-sm" ellipsis>
                {primaryLabel}
            </Typography.Text>
            {groupLabel ? (
                <Typography.Text type="secondary" className="text-xs" ellipsis>
                    {groupLabel}
                </Typography.Text>
            ) : null}
        </div>
    )
}

const DefaultNodeLabel = ({label, emphasize}: {label: string; emphasize?: boolean}) => (
    <Typography.Text className={emphasize ? "font-semibold text-sm" : "text-sm"} ellipsis>
        {label}
    </Typography.Text>
)
