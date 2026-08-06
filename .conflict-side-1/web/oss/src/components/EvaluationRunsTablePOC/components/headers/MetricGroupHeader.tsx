import {useEffect, useMemo} from "react"

import {Typography} from "antd"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import useEvaluatorReference from "@/oss/components/References/hooks/useEvaluatorReference"
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"

import {createEvaluatorOutputTypesKey, setOutputTypesMap} from "../../atoms/evaluatorOutputTypes"
import {evaluationRunsProjectIdAtom} from "../../atoms/view"

interface MetricGroupHeaderProps {
    slug?: string | null
    evaluatorId?: string | null
    fallbackLabel?: string | null
    columnKey?: string | null
    projectId?: string | null
}

const MetricGroupHeader = ({
    slug,
    evaluatorId,
    fallbackLabel,
    columnKey,
    projectId,
}: MetricGroupHeaderProps) => {
    const sanitizedSlug = useMemo(() => {
        if (!slug) return null
        const trimmed = slug.trim()
        return trimmed.length ? trimmed : null
    }, [slug])

    const tableProjectId = useAtomValueWithSchedule(evaluationRunsProjectIdAtom, {
        priority: LOW_PRIORITY,
    })
    const effectiveProjectId = projectId ?? tableProjectId ?? null

    const {reference: evaluatorReference} = useEvaluatorReference(
        {
            projectId: effectiveProjectId,
            evaluatorSlug: sanitizedSlug,
            evaluatorId,
        },
        {
            enabled: Boolean(effectiveProjectId && (sanitizedSlug || evaluatorId)),
        },
    )

    // Update the output types atom when evaluator reference is loaded
    const outputTypesKey = useMemo(
        () => createEvaluatorOutputTypesKey(effectiveProjectId, sanitizedSlug),
        [effectiveProjectId, sanitizedSlug],
    )

    useEffect(() => {
        if (!evaluatorReference?.metrics?.length) return

        const outputTypesMap = new Map<string, string | null>()
        evaluatorReference.metrics.forEach((metric) => {
            if (metric.canonicalPath) {
                outputTypesMap.set(
                    canonicalizeMetricKey(metric.canonicalPath),
                    metric.outputType ?? null,
                )
            }
        })

        // Use module-level cache instead of Jotai atom (works across stores)
        setOutputTypesMap(outputTypesKey, outputTypesMap)
    }, [evaluatorReference?.metrics, outputTypesKey])

    const label =
        evaluatorReference?.name ??
        fallbackLabel ??
        sanitizedSlug ??
        evaluatorReference?.slug ??
        evaluatorId ??
        "Evaluator"

    return (
        <Typography.Text className="break-keep text-left" ellipsis>
            {label}
        </Typography.Text>
    )
}

export default MetricGroupHeader
