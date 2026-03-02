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
import {Tag, Skeleton} from "antd"

import {cn} from "../../../utils/styles"

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
                <Skeleton.Button active size="small" style={{width: 60}} />
            </div>
        )
    }

    if (!hasAnyMetrics) {
        return null
    }

    return (
        <div className={cn("flex items-center gap-1", className)}>
            {showLatency && formattedLatency && (
                <Tag color="default" className={tagClassName}>
                    <Timer size={iconSize} /> {formattedLatency}
                </Tag>
            )}

            {showTokens && formattedTokens && (
                <Tag color="default" className={tagClassName}>
                    <Hash size={iconSize} /> {formattedTokens}
                </Tag>
            )}

            {showCost && formattedCost && (
                <Tag color="default" className={tagClassName}>
                    <Coins size={iconSize} /> {formattedCost}
                </Tag>
            )}
        </div>
    )
})

export default ExecutionMetricsDisplay
