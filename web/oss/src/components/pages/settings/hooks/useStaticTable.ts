import {useMemo} from "react"

import type {TableFeaturePagination, TableScopeConfig} from "@agenta/ui/table"

/**
 * Config for a settings table: a fully-materialized list, no fetching, no pagination.
 *
 * `InfiniteVirtualTableFeatureShell` still requires a `pagination` object when no
 * `datasetStore` is supplied, so every settings table needs the same no-op shape. This
 * keeps that shape in one place instead of eleven.
 */
export const useStaticTable = <Row extends {key: React.Key}>(scopeId: string, rows: Row[]) => {
    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            // One page holds the whole list.
            scopeId,
            pageSize: Math.max(rows.length, 1),
            enableInfiniteScroll: false,
        }),
        [scopeId, rows.length],
    )

    const pagination = useMemo<TableFeaturePagination<Row>>(
        () => ({rows, loadNextPage: () => undefined, resetPages: () => undefined}),
        [rows],
    )

    return {tableScope, pagination}
}
