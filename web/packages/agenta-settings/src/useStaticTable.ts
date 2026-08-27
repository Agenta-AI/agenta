import {useMemo} from "react"

import type {TableFeaturePagination, TableScopeConfig} from "@agenta/ui/table"

const DEFAULT_SKELETON_COUNT = 5

/**
 * Config for a settings table: a fully-materialized list, no fetching, no pagination.
 *
 * `InfiniteVirtualTableFeatureShell` still requires a `pagination` object when no
 * `datasetStore` is supplied, so every settings table needs the same no-op shape. This
 * keeps that shape in one place instead of eleven.
 *
 * Pass `{loading}` and, on the FIRST load (busy with nothing to show yet), the returned
 * `pagination.rows` become `skeletonCount` placeholder rows flagged `__isSkeleton`. The
 * table dims + pulses them and treats them as non-interactive; the standard columns paint a
 * `SkeletonLine` per cell. A refetch (rows already present) keeps the real rows — no flash.
 * Consumers drive the body off `pagination.rows`, so they must NOT also pass a `dataSource`.
 */
export const useStaticTable = <Row extends {key: React.Key}>(
    scopeId: string,
    rows: Row[],
    opts: {loading?: boolean; skeletonCount?: number} = {},
) => {
    const {loading = false, skeletonCount = DEFAULT_SKELETON_COUNT} = opts
    const showSkeleton = loading && rows.length === 0

    const displayRows = useMemo<Row[]>(() => {
        if (!showSkeleton) return rows
        return Array.from(
            {length: Math.max(skeletonCount, 1)},
            (_, i) => ({key: `skeleton-${i}`, __isSkeleton: true}) as unknown as Row,
        )
    }, [showSkeleton, rows, skeletonCount])

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            // One page holds the whole list.
            scopeId,
            pageSize: Math.max(displayRows.length, 1),
            enableInfiniteScroll: false,
        }),
        [scopeId, displayRows.length],
    )

    const pagination = useMemo<TableFeaturePagination<Row>>(
        () => ({rows: displayRows, loadNextPage: () => undefined, resetPages: () => undefined}),
        [displayRows],
    )

    return {tableScope, pagination}
}
