/**
 * Table Row Helpers
 *
 * Creates reusable skeleton and merge row functions for paginated tables.
 * Copied from @agenta/ui to avoid dependency.
 */

import type {InfiniteTableRowBase, WindowingState} from "../tableTypes"

/**
 * Configuration for creating table row helpers
 */
export interface TableRowHelpersConfig<TRow extends InfiniteTableRowBase, TApiRow> {
    /** Prefix for skeleton row keys (e.g., "testset", "evaluation-run") */
    entityName: string
    /** Default values for skeleton rows */
    skeletonDefaults: Omit<TRow, "key" | "__isSkeleton">
    /** Extract the unique ID from an API row (used as the row key) */
    getRowId: (apiRow: TApiRow) => string
    /**
     * Optional custom merge logic. If not provided, uses simple spread.
     * Use this when you need to transform API data or handle null values specially.
     */
    customMerge?: (skeleton: TRow, apiRow: TApiRow) => TRow
    /**
     * Optional: Transform API row to table row.
     * Use this when TRow !== TApiRow and you need to convert.
     */
    apiToRow?: (apiRow: TApiRow) => TRow
}

/**
 * Parameters for creating a skeleton row
 */
export interface CreateSkeletonRowParams {
    scopeId: string | null
    offset: number
    index: number
    windowing: WindowingState | null
    rowKey: string
}

/**
 * Parameters for merging a skeleton with API data
 */
export interface MergeRowParams<TRow, TApiRow> {
    skeleton: TRow
    apiRow?: TApiRow
}

/**
 * Creates reusable skeleton and merge row functions for a table.
 */
export function createTableRowHelpers<TRow extends InfiniteTableRowBase, TApiRow>(
    config: TableRowHelpersConfig<TRow, TApiRow>,
) {
    const {entityName, skeletonDefaults, getRowId, customMerge, apiToRow} = config

    /**
     * Creates a skeleton row for loading states
     */
    const createSkeletonRow = ({scopeId, offset, index, rowKey}: CreateSkeletonRowParams): TRow => {
        const computedIndex = offset + index + 1
        const scopePrefix = scopeId ? `${scopeId}::` : ""
        const key = `${scopePrefix}skeleton-${entityName}-${computedIndex}-${rowKey}`

        return {
            ...skeletonDefaults,
            key,
            __isSkeleton: true,
        } as TRow
    }

    /**
     * Merges a skeleton row with actual API data
     */
    const mergeRow = ({skeleton, apiRow}: MergeRowParams<TRow, TApiRow>): TRow => {
        if (!apiRow) {
            return skeleton
        }

        if (customMerge) {
            return customMerge(skeleton, apiRow)
        }

        // If apiToRow is provided, use it to transform the API row
        if (apiToRow) {
            const transformed = apiToRow(apiRow)
            return {
                ...transformed,
                key: getRowId(apiRow),
                __isSkeleton: false,
            } as TRow
        }

        // Default merge: spread API row and add key + skeleton flag
        return {
            ...apiRow,
            key: getRowId(apiRow),
            __isSkeleton: false,
        } as unknown as TRow
    }

    return {
        createSkeletonRow,
        mergeRow,
    }
}

export type TableRowHelpers<TRow extends InfiniteTableRowBase, TApiRow> = ReturnType<
    typeof createTableRowHelpers<TRow, TApiRow>
>
