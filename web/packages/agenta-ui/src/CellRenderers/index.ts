/**
 * Shared cell content renderers for table cells
 *
 * These components provide optimized, consistent rendering for testcase/scenario data
 * across different tables (TestcasesTable, EvalRunDetails scenarios table, etc.)
 *
 * Key optimizations:
 * - Plain text rendering instead of heavy editor components
 * - Truncation for cell preview (lines + characters)
 * - Full content in popover on hover
 * - Memoization for performance
 */

export {default as CellContentPopover} from "./CellContentPopover"
export {default as JsonCellContent} from "./JsonCellContent"
export {default as TextCellContent} from "./TextCellContent"
export {default as ChatMessagesCellContent} from "./ChatMessagesCellContent"
export {default as SmartCellContent} from "./SmartCellContent"
export {default as LastInputMessageCell} from "./LastInputMessageCell"
export {default as MetricCellContent, MetricValueDisplay} from "./MetricCellContent"
export type {MetricCellContentProps} from "./MetricCellContent"
export {default as EvaluatorMetricBar} from "./EvaluatorMetricBar"
export type {EvaluatorMetricBarProps} from "./EvaluatorMetricBar"

export * from "./utils"
export * from "./constants"
export * from "./metricUtils"
