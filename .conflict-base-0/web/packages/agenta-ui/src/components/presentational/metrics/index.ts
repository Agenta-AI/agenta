/**
 * Metrics Display Components
 *
 * Pure presentational components for displaying execution metrics
 * (latency, tokens, cost) and mapping status indicators.
 *
 * @example
 * ```tsx
 * import { ExecutionMetricsDisplay, MappingStatusTag } from '@agenta/ui'
 *
 * <ExecutionMetricsDisplay
 *   metrics={{ durationMs: 1500, totalTokens: 256 }}
 * />
 *
 * <MappingStatusTag status="auto" />
 * ```
 */

export {
    ExecutionMetricsDisplay,
    type ExecutionMetricsDisplayProps,
    type ExecutionMetricsData,
} from "./ExecutionMetricsDisplay"

export {MappingStatusTag, type MappingStatusTagProps} from "./MappingStatusTag"
