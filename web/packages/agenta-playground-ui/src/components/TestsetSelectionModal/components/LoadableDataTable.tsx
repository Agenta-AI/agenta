/**
 * LoadableDataTable Component
 *
 * Displays loadable rows in a table format for the save mode preview.
 * Uses InfiniteVirtualTableFeatureShell from @agenta/ui with proper IVT integration.
 *
 * This component reads loadable data directly from the loadable controller
 * and uses the identity-only row pattern - rows contain only identifiers,
 * cell data is accessed via testcase.get.cell().
 */

import {useCallback, useMemo} from "react"

import {testcase} from "@agenta/entities"
import {loadableController} from "@agenta/entities/loadable"
import {SmartCellContent} from "@agenta/ui/cell-renderers"
import {
    DEFAULT_ROW_HEIGHT_CONFIG,
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"

const {Text} = Typography

// Use small row height for preview
const ROW_HEIGHT = DEFAULT_ROW_HEIGHT_CONFIG.sizes.small.height

// ============================================================================
// TYPES
// ============================================================================

export interface LoadableDataTableProps {
    /** Loadable ID to display data from */
    loadableId: string
}

/**
 * Identity-only row type - contains only identifiers, no entity data.
 * Cell data is accessed via testcase.get.cell(id, columnKey).
 */
interface LoadableTableRow {
    id: string
    key: string
    __isSkeleton?: boolean
    /** Index signature for InfiniteTableRowBase compatibility */
    [key: string]: unknown
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LoadableDataTable({loadableId}: LoadableDataTableProps) {
    // Read rows directly from loadable controller (returns {id, data} objects)
    const rowsAtom = useMemo(() => loadableController.selectors.rows(loadableId), [loadableId])
    const loadableRows = useAtomValue(rowsAtom) as {
        id: string
        data: Record<string, unknown>
    }[]

    // Transform loadable rows to identity-only table rows
    const tableRows: LoadableTableRow[] = useMemo(() => {
        if (!loadableRows || loadableRows.length === 0) return []
        return loadableRows.map((row) => ({
            id: row.id,
            key: row.id,
            __isSkeleton: false,
        }))
    }, [loadableRows])

    // Cell accessor using testcase molecule
    const getCellValue = useCallback((record: LoadableTableRow, columnKey: string): unknown => {
        return testcase.get.cell(record.id, columnKey)
    }, [])

    // Table scope configuration
    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: `save-testset-preview-${loadableId}`,
            pageSize: Math.max(tableRows.length, 10),
            enableInfiniteScroll: false,
        }),
        [loadableId, tableRows.length],
    )

    // Static pagination - data comes from loadable controller
    const pagination = useMemo<TableFeaturePagination<LoadableTableRow>>(
        () => ({
            rows: tableRows,
            loadNextPage: () => {},
            resetPages: () => {},
        }),
        [tableRows],
    )

    // Build columns dynamically from testcase data
    const columns: ColumnsType<LoadableTableRow> = useMemo(() => {
        if (tableRows.length === 0) return []

        // Collect all unique keys from testcase data using the first row
        const keySet = new Set<string>()
        for (const row of tableRows) {
            const tcData = testcase.get.data(row.id)
            if (tcData?.data) {
                for (const key of Object.keys(tcData.data)) {
                    keySet.add(key)
                }
            }
        }

        // Build column definitions using getCellValue for consistent rendering
        return Array.from(keySet).map((key) => ({
            key,
            title: key,
            dataIndex: key,
            width: 200,
            ellipsis: true,
            render: (_: unknown, record: LoadableTableRow) => (
                <SmartCellContent
                    value={getCellValue(record, key)}
                    keyPrefix={`${record.id}-${key}`}
                />
            ),
        }))
    }, [tableRows, getCellValue])

    if (tableRows.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <Text type="secondary">No testcases to display</Text>
            </div>
        )
    }

    return (
        <div className="h-full w-full overflow-hidden">
            <InfiniteVirtualTableFeatureShell<LoadableTableRow>
                datasetStore={null}
                tableScope={tableScope}
                columns={columns}
                rowKey="key"
                pagination={pagination}
                rowHeight={ROW_HEIGHT}
                autoHeight
                tableProps={{
                    size: "small",
                }}
            />
        </div>
    )
}

export default LoadableDataTable
