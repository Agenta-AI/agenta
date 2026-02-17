import {memo, useCallback, useMemo} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {
    getStatusLabel,
    getStatusSeverity,
    inferStatusFromSummary,
    type ExecutionStatus,
} from "@agenta/shared/utils"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {TreeView} from "@phosphor-icons/react"
import {Button, Skeleton, Tag, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

export interface SharedGenerationResultUtilsProps {
    /** Trace ID used to fetch summary metrics and open trace drawer */
    traceId?: string | null
    /** Optional className */
    className?: string
    /** Show status tag extracted from root span status_code */
    showStatus?: boolean
    /** Show only actions (no metrics/status) */
    actionsOnly?: boolean
    /** Callback for opening trace details */
    onViewTrace?: (params: {traceId: string; spanId?: string | null}) => void
}

const SharedGenerationResultUtils = ({
    traceId,
    className,
    showStatus = true,
    actionsOnly = false,
    onViewTrace,
}: SharedGenerationResultUtilsProps) => {
    const summary = useAtomValue(
        useMemo(() => traceDataSummaryAtomFamily(traceId ?? null), [traceId]),
    )
    const status: ExecutionStatus = useMemo(() => {
        const statusCode = (summary.rootSpan?.status_code as string | undefined) ?? undefined
        const explicit = getStatusLabel(statusCode)
        if (explicit && explicit !== "Unset") return explicit
        return inferStatusFromSummary({
            rootSpan: summary.rootSpan as Record<string, unknown> | null,
            agData: summary.agData as Record<string, unknown> | null,
            metrics: summary.metrics,
        })
    }, [summary.agData, summary.metrics, summary.rootSpan])

    const onOpenTrace = useCallback(
        (event: React.MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            if (!traceId || !onViewTrace) return
            onViewTrace({traceId, spanId: summary.rootSpan?.span_id ?? null})
        },
        [onViewTrace, summary.rootSpan?.span_id, traceId],
    )

    if (!traceId) return null

    if (summary.isPending) {
        return (
            <div className={clsx("flex items-center gap-2 flex-nowrap", className)}>
                <Tooltip title="Open trace">
                    <Button
                        type="default"
                        size="small"
                        icon={<TreeView size={14} />}
                        loading
                        disabled
                        data-ivt-stop-row-click
                    />
                </Tooltip>
                {showStatus ? <Skeleton.Button active size="small" style={{width: 96}} /> : null}
                {!actionsOnly ? (
                    <>
                        <Skeleton.Button active size="small" style={{width: 82}} />
                        <Skeleton.Button active size="small" style={{width: 64}} />
                        <Skeleton.Button active size="small" style={{width: 104}} />
                    </>
                ) : null}
            </div>
        )
    }

    return (
        <div className={clsx("flex items-center gap-2 flex-nowrap", className)}>
            <Tooltip title="Open trace">
                <Button
                    type="default"
                    size="small"
                    icon={<TreeView size={14} />}
                    loading={summary.isPending}
                    disabled={!onViewTrace}
                    onClick={onOpenTrace}
                    data-ivt-stop-row-click
                />
            </Tooltip>
            {showStatus && status ? (
                <Tag color={getStatusSeverity(status)} className="m-0">
                    {status}
                </Tag>
            ) : null}
            {!actionsOnly ? (
                <ExecutionMetricsDisplay metrics={summary.metrics} isLoading={summary.isPending} />
            ) : null}
        </div>
    )
}

export default memo(SharedGenerationResultUtils)
