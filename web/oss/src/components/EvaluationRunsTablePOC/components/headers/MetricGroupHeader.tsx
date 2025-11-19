import {useMemo} from "react"

import {Typography} from "antd"
import {useAtomValueWithSchedule, LOW_PRIORITY} from "jotai-scheduler"

import useEvaluatorReference from "@/oss/components/References/hooks/useEvaluatorReference"
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
