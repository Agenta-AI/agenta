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
 *
 * This is a connected component that uses ExecutionMetricsDisplay from
 * @agenta/ui for the underlying presentation.
 */

import {memo, useMemo} from "react"

import {traceDataSummaryAtomFamily, type TraceMetrics} from "@agenta/entities/loadable"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
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

/**
 * Connected component that fetches metrics from trace data and displays them
 * using the pure ExecutionMetricsDisplay component from @agenta/ui.
 */
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

    // Return null if neither traceId nor inline tree data provided
    if (!traceId && !tree) return null

    // Use the pure presentational component from @agenta/ui
    return <ExecutionMetricsDisplay metrics={metrics} isLoading={isLoading} className={className} />
}

export default memo(ExecutionMetrics)
