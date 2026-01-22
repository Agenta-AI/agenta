/**
 * ExecutionMetrics - Display execution metrics from trace/span data
 *
 * This component displays metrics (latency, tokens, cost) for an execution
 * using the unified traceDataSummaryAtomFamily (single source of truth).
 *
 * Unlike the OSS SharedGenerationResultUtils, this component:
 * - Uses the unified trace data summary atom (shared with output mapping)
 * - Does not include trace drawer opening (injectable via context)
 * - Is suitable for use in the playground package
 */

import {memo, useMemo} from "react"

import {traceDataSummaryAtomFamily, type TraceMetrics} from "@agenta/entities/loadable"
import {formatCurrency, formatLatency, formatTokenUsage} from "@agenta/shared"
import {cn} from "@agenta/ui"
import {Timer, Coins, Hash} from "@phosphor-icons/react"
import {Tag, Skeleton} from "antd"
import {useAtomValue} from "jotai"

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutionMetricsProps {
    /** Trace ID for fetching metrics from server */
    traceId?: string | null
    /** Inline tree data with metrics (alternative to traceId) */
    tree?: InlineTreeData | null
    /** Additional CSS class names */
    className?: string
    /** Show status indicator */
    showStatus?: boolean
    /** Callback when trace button is clicked (for opening trace drawer) */
    onViewTrace?: (traceId: string, spanId?: string) => void
}

export interface InlineTreeData {
    nodes?: TreeNode[]
    trace_id?: string
}

interface TreeNode {
    metrics?: {
        acc?: MetricSet
        unit?: MetricSet
    }
    status?: string
}

interface MetricSet {
    duration?: {total?: number}
    tokens?: {total?: number; prompt?: number; completion?: number}
    costs?: {total?: number}
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Extract metrics from inline tree data (legacy format)
 */
const extractInlineMetrics = (tree: InlineTreeData): TraceMetrics => {
    if (!tree.nodes?.length) return {}

    const node = tree.nodes[0]
    const metric = node?.metrics?.acc || node?.metrics?.unit

    return {
        durationMs: metric?.duration?.total,
        totalTokens: metric?.tokens?.total,
        promptTokens: metric?.tokens?.prompt,
        completionTokens: metric?.tokens?.completion,
        totalCost: metric?.costs?.total,
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

const ExecutionMetrics = ({traceId, tree, className}: ExecutionMetricsProps) => {
    // Determine effective trace ID (from prop or inline tree)
    const effectiveTraceId = traceId ?? tree?.trace_id ?? null

    // Use unified trace data summary atom (single source of truth)
    // This atom is shared with output mapping, avoiding duplicate fetches
    const traceSummaryAtom = useMemo(
        () => traceDataSummaryAtomFamily(!tree ? effectiveTraceId : null),
        [effectiveTraceId, tree],
    )
    const traceSummary = useAtomValue(traceSummaryAtom)

    // Get metrics from unified source or inline tree
    const metrics = useMemo((): TraceMetrics => {
        if (tree) {
            // Use inline tree data if provided
            return extractInlineMetrics(tree)
        }
        // Use metrics from unified trace data summary
        return traceSummary.metrics
    }, [tree, traceSummary.metrics])

    // Only show loading if we're actually fetching (no inline tree and query is pending)
    const isLoading = !tree && traceSummary.isPending

    // Format metrics for display
    const formattedLatency = useMemo(
        () => formatLatency(metrics.durationMs !== undefined ? metrics.durationMs / 1000 : null),
        [metrics.durationMs],
    )
    const formattedTokens = useMemo(
        () => formatTokenUsage(metrics.totalTokens),
        [metrics.totalTokens],
    )
    const formattedCosts = useMemo(() => formatCurrency(metrics.totalCost), [metrics.totalCost])

    // Return null if neither traceId nor inline tree data provided
    if (!traceId && !tree) return null

    if (isLoading) {
        return (
            <div className={cn("flex items-center gap-1", className)}>
                <Skeleton.Button active size="small" style={{width: 60}} />
            </div>
        )
    }

    const hasMetrics =
        metrics.durationMs !== undefined ||
        metrics.totalTokens !== undefined ||
        metrics.totalCost !== undefined

    if (!hasMetrics) return null

    return (
        <div className={cn("flex items-center gap-1", className)}>
            {metrics.durationMs !== undefined && (
                <Tag color="default" className="flex items-center gap-1 m-0">
                    <Timer size={12} /> {formattedLatency}
                </Tag>
            )}

            {metrics.totalTokens !== undefined && (
                <Tag color="default" className="flex items-center gap-1 m-0">
                    <Hash size={12} /> {formattedTokens}
                </Tag>
            )}

            {metrics.totalCost !== undefined && (
                <Tag color="default" className="flex items-center gap-1 m-0">
                    <Coins size={12} /> {formattedCosts}
                </Tag>
            )}
        </div>
    )
}

export default memo(ExecutionMetrics)
