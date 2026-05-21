/**
 * observabilityTraceFetchPage — the oss-side transport adapter for the
 * batch-add-to-queue ETL pipeline.
 *
 * Wraps `executeTraceQuery` into the `TracePageFetcher` shape the package's
 * `addAllMatchingTracesToQueue` expects. This is the only oss-coupled glue the
 * pipeline needs — it owns the observability-query seeding (`size`, `newest`);
 * the scan loop itself lives in `@agenta/entities/etl`.
 */

import type {TracePage, TracePageFetcher} from "@agenta/entities/simpleQueue/etl"

import {Condition, executeTraceQuery} from "../atoms/queryHelpers"

/** Default rows requested per page. */
const DEFAULT_PAGE_SIZE = 500

export interface ObservabilityTraceFetchPageArgs {
    /** Observability query params (filter, focus, sort window). */
    params: Record<string, any>
    appId: string
    isHasAnnotationSelected: number
    hasAnnotationConditions: Condition[]
    hasAnnotationOperator?: string
    /** Rows per page request. Default 500. */
    pageSize?: number
}

/**
 * Build the `fetchPage` the ETL trace-scan source calls. The observability
 * window is seeded once (`size`, and `newest` defaulted to "now" when the
 * caller's window has no upper bound); each call pages strictly backwards by
 * cursor.
 */
export const createObservabilityTraceFetchPage = ({
    params,
    appId,
    isHasAnnotationSelected,
    hasAnnotationConditions,
    hasAnnotationOperator,
    pageSize = DEFAULT_PAGE_SIZE,
}: ObservabilityTraceFetchPageArgs): TracePageFetcher => {
    const scanParams: Record<string, any> = {...params, size: pageSize}
    if (!scanParams.newest) {
        scanParams.newest = new Date().toISOString()
    }

    return async (cursor, signal): Promise<TracePage> => {
        const result = await executeTraceQuery({
            params: scanParams,
            pageParam: cursor ? {newest: cursor} : undefined,
            appId,
            isHasAnnotationSelected,
            hasAnnotationConditions,
            hasAnnotationOperator,
            signal,
        })
        return {
            rows: result.traces,
            nextCursor: result.nextCursor ?? null,
        }
    }
}
