/**
 * Entity Column Builder
 *
 * Converts entity column definitions (any type extending `GroupableColumn`) into
 * Ant Design `ColumnsType` using the `groupColumns` utility and `SmartCellContent`
 * for default cell rendering.
 *
 * This helper standardizes column building for entity tables, reducing boilerplate
 * in entity-specific table components.
 *
 * @example
 * ```typescript
 * import { buildEntityColumns, type GroupableColumn } from '@agenta/ui'
 *
 * interface MyColumn extends GroupableColumn {
 *   width?: number
 * }
 *
 * const columns: MyColumn[] = [
 *   { key: 'name', label: 'Name' },
 *   { key: 'inputs.prompt', label: 'prompt', parentKey: 'inputs' },
 * ]
 *
 * const antdColumns = buildEntityColumns(columns, {
 *   getRowData: (record) => record as Record<string, unknown>,
 *   defaultWidth: 150,
 * })
 * ```
 *
 * @module buildEntityColumns
 */

import type {ReactNode} from "react"

import {getValueAtStringPath} from "@agenta/shared/utils"
import type {ColumnType, ColumnsType} from "antd/es/table"

import {SmartCellContent} from "../../CellRenderers"
import {
    type GroupableColumn,
    type GroupColumnsOptions,
    groupColumns,
} from "../../utils/groupColumns"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for building entity columns.
 *
 * @template TRow - Row data type
 * @template TColumn - Column definition type (must extend GroupableColumn)
 */
export interface BuildEntityColumnsOptions<
    TRow,
    TColumn extends GroupableColumn = GroupableColumn,
> {
    /**
     * Function to resolve full row data from a row record.
     *
     * Entity tables often store row data in entity molecules rather than
     * directly in the row object. This function provides the mapping.
     *
     * @param record - The table row record
     * @returns The data object to extract cell values from, or null
     */
    getRowData: (record: TRow) => Record<string, unknown> | null

    /**
     * Optional function to get a cell value directly.
     *
     * When provided, this function is called instead of using `getRowData` + path extraction.
     * This allows for fine-grained cell-level data access (e.g., from reactive atoms).
     *
     * @param record - The table row record
     * @param columnKey - The column key/path
     * @returns The cell value
     */
    getCellValue?: (record: TRow, columnKey: string) => unknown

    /**
     * Default column width in pixels.
     * @default 150
     */
    defaultWidth?: number

    /**
     * Column grouping options (collapsible headers, max depth, etc.).
     * Passed directly to `groupColumns`.
     */
    grouping?: GroupColumnsOptions<TRow, TColumn>

    /**
     * Custom cell renderer override.
     *
     * When provided, this function is called for each cell instead of
     * the default `SmartCellContent`. Receives the extracted value and
     * the full row data.
     *
     * @param value - The value at the column's path
     * @param rowData - The full row data (or null)
     * @param column - The column definition
     * @returns ReactNode to render in the cell
     */
    renderCell?: (
        value: unknown,
        rowData: Record<string, unknown> | null,
        column: TColumn,
    ) => ReactNode
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/** Default column width when not specified */
const DEFAULT_COLUMN_WIDTH = 150

// ============================================================================
// BUILDER
// ============================================================================

/**
 * Build Ant Design table columns from entity column definitions.
 *
 * Converts `GroupableColumn[]` (or any subtype like `EntityColumnDef`) into
 * `ColumnsType` using the `groupColumns` utility. Uses `SmartCellContent` as
 * the default cell renderer with path-based value extraction.
 *
 * @template TRow - Row data type
 * @template TColumn - Column definition type
 *
 * @param columns - Array of column definitions
 * @param options - Configuration for rendering, grouping, and width
 * @returns Ant Design ColumnsType ready for table rendering
 *
 * @example
 * ```typescript
 * // Basic usage
 * const antdColumns = buildEntityColumns(entityColumns, {
 *   getRowData: (record) => record as Record<string, unknown>,
 * })
 *
 * // With grouping
 * const antdColumns = buildEntityColumns(entityColumns, {
 *   getRowData: (record) => entityMolecule.get.data(record.id),
 *   grouping: {
 *     collapsedGroups,
 *     onGroupHeaderClick: toggleCollapse,
 *     maxDepth: 1,
 *   },
 * })
 * ```
 */
export function buildEntityColumns<
    TRow,
    TColumn extends GroupableColumn & {width?: number} = GroupableColumn & {width?: number},
>(columns: TColumn[], options: BuildEntityColumnsOptions<TRow, TColumn>): ColumnsType<TRow> {
    const {
        getRowData,
        getCellValue,
        defaultWidth = DEFAULT_COLUMN_WIDTH,
        grouping,
        renderCell,
    } = options

    const createColumnDef = (col: TColumn, displayName: string): ColumnType<TRow> => ({
        key: col.key,
        title: displayName,
        width: col.width ?? defaultWidth,
        ellipsis: true,
        render: (_, record) => {
            // Use getCellValue if provided, otherwise fall back to getRowData + path extraction
            let value: unknown
            let dataSource: Record<string, unknown> | null = null

            if (getCellValue) {
                value = getCellValue(record, col.key)
            } else {
                dataSource = getRowData(record)
                if (!dataSource) return null
                value = getValueAtStringPath(dataSource, col.key)
            }

            if (renderCell) {
                // For renderCell, we need dataSource - resolve it if not already done
                if (!dataSource && !getCellValue) {
                    dataSource = getRowData(record)
                } else if (getCellValue && !dataSource) {
                    // When using getCellValue, dataSource is not available
                    // renderCell should work with just the value
                    dataSource = null
                }
                return renderCell(value, dataSource, col)
            }
            return <SmartCellContent value={value} />
        },
    })

    return groupColumns<TRow, TColumn>(columns, createColumnDef, grouping)
}
