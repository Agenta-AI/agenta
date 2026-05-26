/**
 * @agenta/entities/trace/etl
 *
 * Bulk-trace export ETL pipelines — pages every trace matching a filter,
 * flattens each tree, dedups, caps, and flushes rows in fixed-size batches to
 * a caller-provided transport. Composes the generic primitives from
 * `@agenta/entities/etl`. Format-agnostic — the caller's `flushBatch` does
 * the CSV/JSON/... encoding.
 *
 * @packageDocumentation
 */

export {DEFAULT_BATCH_SIZE, DEFAULT_MAX_ROWS, exportMatchingTraces} from "./exportMatchingTraces"
export {
    ADAPTIVE_CEILING_DELAY_MS,
    ADAPTIVE_FLOOR_DELAY_MS,
    ADAPTIVE_RAMP_START_FILL,
    computeAdaptivePageDelayMs,
} from "./adaptivePacing"
export type {AdaptivePacingRateLimit} from "./adaptivePacing"
export {
    inferQueueMaxFromPlan,
    QUEUE_MAX_BUSINESS,
    QUEUE_MAX_ENTERPRISE,
    QUEUE_MAX_HOBBY,
    QUEUE_MAX_PRO,
} from "./tierQueueCap"
export type {
    ExportMatchingTracesOptions,
    ExportMatchingTracesProgress,
    ExportMatchingTracesResult,
    ExportTracePage,
    ExportTracePageFetcher,
    FlushBatch,
    ScannedExportRow,
} from "./exportMatchingTraces"

// Re-exported so consumers have one import surface for the feature.
export {BatchFlushError} from "../../etl"
