import {memo, useCallback, useMemo} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {
    getStatusLabel,
    getStatusSeverity,
    inferStatusFromSummary,
    type ExecutionStatus,
} from "@agenta/shared/utils"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {
    Badge,
    LoadingButton,
    SkeletonBlock,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {TreeView} from "@phosphor-icons/react"
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
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <LoadingButton
                                variant="outline"
                                size="icon-sm"
                                loading
                                disabled
                                aria-label="Open trace"
                                data-ivt-stop-row-click
                            />
                        </TooltipTrigger>
                        <TooltipContent>Open trace</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                {showStatus ? (
                    <SkeletonBlock active className="h-6 w-auto" style={{width: 96}} />
                ) : null}
                {!actionsOnly ? (
                    <>
                        <SkeletonBlock active className="h-6 w-auto" style={{width: 82}} />
                        <SkeletonBlock active className="h-6 w-auto" style={{width: 64}} />
                        <SkeletonBlock active className="h-6 w-auto" style={{width: 104}} />
                    </>
                ) : null}
            </div>
        )
    }

    return (
        <div className={clsx("flex items-center gap-2 flex-nowrap", className)}>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <LoadingButton
                            variant="outline"
                            size="icon-sm"
                            loading={summary.isPending}
                            disabled={!onViewTrace}
                            onClick={onOpenTrace}
                            aria-label="Open trace"
                            data-ivt-stop-row-click
                        >
                            {summary.isPending ? null : <TreeView size={14} />}
                        </LoadingButton>
                    </TooltipTrigger>
                    <TooltipContent>Open trace</TooltipContent>
                </Tooltip>
            </TooltipProvider>
            {showStatus && status ? (
                <Badge variant={getStatusSeverity(status)}>{status}</Badge>
            ) : null}
            {!actionsOnly ? (
                <ExecutionMetricsDisplay metrics={summary.metrics} isLoading={summary.isPending} />
            ) : null}
        </div>
    )
}

export default memo(SharedGenerationResultUtils)
