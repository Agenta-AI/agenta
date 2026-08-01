/**
 * ExecutionMetricsDisplay - Pure presentational component for execution metrics
 *
 * Displays execution metrics (latency, tokens, cost) as a row of tags.
 * This is a pure presentational component with no data fetching logic.
 *
 * For connected versions that fetch from atoms, see @agenta/playground-ui.
 *
 * @example
 * ```tsx
 * import { ExecutionMetricsDisplay } from '@agenta/ui'
 *
 * <ExecutionMetricsDisplay
 *   metrics={{
 *     durationMs: 1500,
 *     totalTokens: 256,
 *     totalCost: 0.0012
 *   }}
 * />
 * ```
 */

import {memo} from "react"

import {formatCurrency, formatLatency, formatTokens} from "@agenta/shared/utils"
import {Timer, Coins, Hash} from "@phosphor-icons/react"

import {cn} from "../../../utils/styles"
import {Badge} from "../../ui/badge"
import {SkeletonBlock} from "../../ui/skeleton"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../ui/tooltip"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metrics data for execution display
 */
export interface ExecutionMetricsData {
    /** Duration in milliseconds */
    durationMs?: number
    /** Total tokens used */
    totalTokens?: number
    /** Prompt/input tokens */
    promptTokens?: number
    /** Completion/output tokens */
    completionTokens?: number
    /** Total cost in dollars */
    totalCost?: number
}

export interface ExecutionMetricsDisplayProps {
    /** Metrics data to display */
    metrics: ExecutionMetricsData
    /** Whether metrics are loading */
    isLoading?: boolean
    /** Additional CSS class names */
    className?: string
    /** Size variant */
    size?: "small" | "default"
    /** Which metrics to show (defaults to all available) */
    show?: ("latency" | "tokens" | "cost")[]
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Pure presentational component for displaying execution metrics
 */
export const ExecutionMetricsDisplay = memo(function ExecutionMetricsDisplay({
    metrics,
    isLoading = false,
    className,
    size = "default",
    show,
}: ExecutionMetricsDisplayProps) {
    // Calculate what to show
    const showLatency = (!show || show.includes("latency")) && metrics.durationMs !== undefined
    const showTokens = (!show || show.includes("tokens")) && metrics.totalTokens !== undefined
    const showCost = (!show || show.includes("cost")) && metrics.totalCost !== undefined

    const hasAnyMetrics = showLatency || showTokens || showCost

    // Format values
    const formattedLatency =
        metrics.durationMs !== undefined ? formatLatency(metrics.durationMs / 1000) : null
    const formattedTokens =
        metrics.totalTokens !== undefined ? formatTokens(metrics.totalTokens) : null
    const formattedCost = metrics.totalCost !== undefined ? formatCurrency(metrics.totalCost) : null

    // Size classes
    const tagClassName = cn("flex items-center gap-1 m-0", size === "small" && "text-xs py-0")
    const iconSize = size === "small" ? 10 : 12

    if (isLoading) {
        return (
            <div className={cn("flex items-center gap-1", className)}>
                <SkeletonBlock active className="h-6" style={{width: 60}} />
            </div>
        )
    }

    if (!hasAnyMetrics) {
        return null
    }

    return (
        <div className={cn("flex items-center gap-1", className)}>
            {showLatency && formattedLatency && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="inline-flex">
                                <Badge variant="default" className={tagClassName}>
                                    <Timer size={iconSize} /> {formattedLatency}
                                </Badge>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">{`Duration: ${formattedLatency}`}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {showTokens && formattedTokens && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="inline-flex">
                                <Badge variant="default" className={tagClassName}>
                                    <Hash size={iconSize} /> {formattedTokens}
                                </Badge>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            {metrics.promptTokens !== undefined &&
                            metrics.completionTokens !== undefined ? (
                                <div className="min-w-[140px]">
                                    <div className="flex items-center justify-between gap-3">
                                        <span>Total Tokens</span>
                                        <span>{formattedTokens}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 opacity-85">
                                        <span>Prompt</span>
                                        <span>{formatTokens(metrics.promptTokens)}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 opacity-85">
                                        <span>Completion</span>
                                        <span>{formatTokens(metrics.completionTokens)}</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-3 min-w-[120px]">
                                    <span>Total Tokens</span>
                                    <span>{formattedTokens}</span>
                                </div>
                            )}
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {showCost && formattedCost && (
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="inline-flex">
                                <Badge variant="default" className={tagClassName}>
                                    <Coins size={iconSize} /> {formattedCost}
                                </Badge>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">{`Total Cost: ${formattedCost}`}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
        </div>
    )
})

export default ExecutionMetricsDisplay
