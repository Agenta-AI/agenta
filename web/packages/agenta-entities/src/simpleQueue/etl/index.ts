/**
 * @agenta/entities/simpleQueue/etl
 *
 * The batch-add-to-queue ETL pipeline — scans every trace matching a filter
 * and adds the deduplicated trace ids to an annotation queue. Composes the
 * generic ETL primitives from `@agenta/entities/etl`.
 *
 * @packageDocumentation
 */

export {addAllMatchingTracesToQueue, DEFAULT_MAX_ITEMS} from "./addMatchingTracesToQueue"
export type {
    AddMatchingTracesOptions,
    AddMatchingTracesProgress,
    AddMatchingTracesResult,
    AddTracesToQueue,
    ScannedTrace,
    TracePage,
    TracePageFetcher,
} from "./addMatchingTracesToQueue"

// Re-exported so consumers have one import surface for the feature.
export {BatchFlushError} from "../../etl"
