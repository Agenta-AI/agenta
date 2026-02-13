import type {WindowingState, InfiniteTableRowBase} from "../types"

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
 * Reduces boilerplate by providing a consistent pattern for all tables.
 *
 * @example
 * ```ts
 * const {createSkeletonRow, mergeRow} = createTableRowHelpers<TestsetTableRow, TestsetApiRow>({
 *   entityName: "testset",
 *   skeletonDefaults: {
 *     id: "",
 *     name: "",
 *     created_at: "",
 *     updated_at: "",
 *   },
 *   getRowId: (row) => row.id,
 * })
 * ```
 */
export function createTableRowHelpers<TRow extends InfiniteTableRowBase, TApiRow>(
    config: TableRowHelpersConfig<TRow, TApiRow>,
) {
    const {entityName, skeletonDefaults, getRowId, customMerge} = config

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
