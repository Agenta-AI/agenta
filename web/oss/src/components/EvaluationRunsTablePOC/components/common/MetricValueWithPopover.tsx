import type {ReactNode} from "react"

import {MetricDetailsPreviewPopover} from "@agenta/evaluations-ui"
import type {BasicStats} from "@agenta/shared/metrics"
import {Typography} from "antd"

const CLASS_NAME = "metric-cell-content text-xs whitespace-pre-wrap"

interface MetricValueWithPopoverProps {
    runId?: string | null
    metricKey?: string
    metricPath?: string
    metricLabel?: string
    stepKey?: string
    stepType?: string
    highlightValue?: unknown
    fallbackValue?: unknown
    display: string
    isPlaceholder?: boolean
    children?: ReactNode
    showScenarioValue?: boolean
    className?: string
    disablePopover?: boolean
    prefetchedStats?: BasicStats | undefined
}

const MetricValueWithPopover = ({
    runId,
    metricKey,
    metricPath,
    metricLabel,
    stepKey,
    stepType,
    highlightValue,
    fallbackValue,
    display,
    isPlaceholder,
    children,
    showScenarioValue = true,
    className,
    disablePopover = false,
    prefetchedStats,
}: MetricValueWithPopoverProps) => {
    const content = (
        <Typography.Text
            className={`${CLASS_NAME} ${isPlaceholder ? "text-neutral-500" : "text-neutral-800"}`}
        >
            {display}
        </Typography.Text>
    )

    if (disablePopover) {
        return (
            <span className={`flex max-w-full truncate ${className ?? ""}`}>
                {children ?? content}
            </span>
        )
    }

    return (
        <MetricDetailsPreviewPopover
            runId={runId ?? undefined}
            metricKey={metricKey}
            metricPath={metricPath}
            metricLabel={metricLabel}
            stepKey={stepKey}
            stepType={stepType}
            highlightValue={highlightValue}
            fallbackValue={fallbackValue ?? display}
            showScenarioValue={showScenarioValue}
            prefetchedStats={prefetchedStats}
        >
            <div className={`flex w-full h-full max-w-full truncate ${className ?? ""}`}>
                {children ?? content}
            </div>
        </MetricDetailsPreviewPopover>
    )
}

export default MetricValueWithPopover
