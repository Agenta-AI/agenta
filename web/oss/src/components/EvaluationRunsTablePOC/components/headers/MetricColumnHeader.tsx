import {useMemo} from "react"

import {Typography} from "antd"
import {useAtomValueWithSchedule, LOW_PRIORITY} from "jotai-scheduler"

import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"
import {resolvedMetricLabelsAtomFamily} from "@/oss/components/References/atoms/resolvedMetricLabels"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"

import {useEvaluatorHeaderReference} from "../../hooks/useEvaluatorHeaderReference"
import useRunMetricSelection from "../../hooks/useRunMetricSelection"
import type {RunMetricDescriptor} from "../../types/runMetrics"

const OUTPUT_METRIC_PATH_PREFIX = /^attributes\.ag\.data\.outputs\.?/i

const stripOutputsNamespace = (value?: string | null) => {
    if (!value) return null
    const stripped = value.replace(OUTPUT_METRIC_PATH_PREFIX, "")
    return stripped.length ? stripped : "output"
}

interface MetricColumnHeaderProps {
    descriptor: RunMetricDescriptor
    fallbackEvaluatorLabel?: string | null
    columnKeyOverride?: string | null
    projectId?: string | null
}

const MetricColumnHeader = ({
    descriptor,
    fallbackEvaluatorLabel,
    columnKeyOverride,
    projectId,
}: MetricColumnHeaderProps) => {
    const isEvaluatorColumn = descriptor.kind === "evaluator"

    const evaluatorSlug = useMemo(() => {
        if (!isEvaluatorColumn) return null
        if (descriptor.evaluatorRef?.slug) return descriptor.evaluatorRef.slug
        if (descriptor.evaluatorRef?.variantSlug) return descriptor.evaluatorRef.variantSlug
        if (descriptor.evaluatorRef?.revisionSlug) return descriptor.evaluatorRef.revisionSlug
        const separatorIndex = descriptor.id.indexOf(":")
        return separatorIndex >= 0 ? descriptor.id.slice(0, separatorIndex) : descriptor.id
    }, [descriptor, isEvaluatorColumn])

    const evaluatorId = useMemo(() => {
        if (!isEvaluatorColumn) return null
        return (
            descriptor.evaluatorRef?.id ??
            descriptor.evaluatorRef?.revisionId ??
            descriptor.evaluatorRef?.variantId ??
            null
        )
    }, [descriptor, isEvaluatorColumn])

    const columnKey = columnKeyOverride ?? descriptor.id

    const {evaluatorReference} = useEvaluatorHeaderReference({
        evaluatorSlug,
        evaluatorId,
        columnKey,
        enabled: isEvaluatorColumn,
        projectIdOverride: descriptor.evaluatorRef?.projectId ?? projectId ?? undefined,
    })

    const sampleRunId = useMemo(() => {
        const descriptorEntries = Object.keys(descriptor.metricPathsByRunId ?? {})
        return descriptorEntries.length ? descriptorEntries[0] : null
    }, [descriptor.metricPathsByRunId])

    const sampleSelection = useRunMetricSelection(
        {
            runId: sampleRunId,
            metricKey: descriptor.metricKey,
            metricPath: descriptor.metricPath,
            stepKey: descriptor.stepKey,
        },
        {
            enabled: isEvaluatorColumn && Boolean(sampleRunId),
        },
    )

    const canonicalDescriptorPath = useMemo(
        () => canonicalizeMetricKey(descriptor.metricPath),
        [descriptor.metricPath],
    )

    const resolvedMetricLabel = useMemo(() => {
        if (!isEvaluatorColumn || !evaluatorReference?.metrics?.length) {
            return null
        }
        const match = evaluatorReference.metrics.find(
            (metric) => metric.canonicalPath === canonicalDescriptorPath,
        )
        return match?.label ?? null
    }, [canonicalDescriptorPath, evaluatorReference?.metrics, isEvaluatorColumn])

    const selectionDerivedLabel = useMemo(() => {
        if (!isEvaluatorColumn) return null
        if (!sampleRunId) return null
        if (sampleSelection.state !== "hasData") return null
        const resolvedKey = sampleSelection.resolvedKey
        if (!resolvedKey) return null
        const normalized = stripOutputsNamespace(resolvedKey) ?? resolvedKey
        return humanizeMetricPath(normalized)
    }, [isEvaluatorColumn, sampleRunId, sampleSelection.state, sampleSelection.resolvedKey])

    const resolvedLabelAtom = useMemo(
        () => resolvedMetricLabelsAtomFamily(descriptor.id),
        [descriptor.id],
    )
    const resolvedLabelFromStore = useAtomValueWithSchedule(resolvedLabelAtom, {
        priority: LOW_PRIORITY,
    })

    const primaryLabel =
        resolvedLabelFromStore ??
        resolvedMetricLabel ??
        descriptor.label ??
        selectionDerivedLabel ??
        humanizeMetricPath(
            stripOutputsNamespace(descriptor.metricPath) ?? descriptor.metricPath ?? "",
        ) ??
        descriptor.metricPath ??
        descriptor.id

    if (!isEvaluatorColumn) {
        return (
            <Typography.Text className="font-medium" ellipsis>
                {primaryLabel}
            </Typography.Text>
        )
    }

    // const evaluatorLabel =
    //     evaluatorReference?.name ?? fallbackEvaluatorLabel ?? evaluatorSlug ?? null

    return (
        <span className="flex min-w-0 flex-col text-left leading-tight break-keep">
            <Typography.Text className="font-medium" ellipsis>
                {primaryLabel}
            </Typography.Text>
            {/* {evaluatorLabel ? (
                <Typography.Text className="text-[11px] text-gray-500" ellipsis>
                    {evaluatorLabel}
                </Typography.Text>
            ) : null} */}
        </span>
    )
}

export default MetricColumnHeader
