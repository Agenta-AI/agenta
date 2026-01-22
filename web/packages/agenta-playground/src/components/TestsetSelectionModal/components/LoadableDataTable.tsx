/**
 * LoadableDataTable Component
 *
 * Displays loadable rows in a table format for the save mode preview.
 * Uses InfiniteVirtualTableFeatureShell from @agenta/ui with proper IVT integration.
 *
 * This component reads loadable data directly from the loadable controller
 * and provides it to IVT via a custom pagination object.
 */

import {useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {
    DEFAULT_ROW_HEIGHT_CONFIG,
    InfiniteVirtualTableFeatureShell,
    SmartCellContent,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui"
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

interface LoadableTableRow {
    id: string
    key: string
    data: Record<string, unknown>
    __isSkeleton?: boolean
    [column: string]: unknown
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LoadableDataTable({loadableId}: LoadableDataTableProps) {
    // Read rows directly from loadable controller
    const rowsAtom = useMemo(
        () => loadableController.testset.selectors.rows(loadableId),
        [loadableId],
    )
    const loadableRows = useAtomValue(rowsAtom) as {
        id: string
        data: Record<string, unknown>
    }[]

    // Transform loadable rows to table rows
    const tableRows: LoadableTableRow[] = useMemo(() => {
        if (!loadableRows || loadableRows.length === 0) return []
        return loadableRows.map((row) => ({
            id: row.id,
            key: row.id,
            data: row.data,
            __isSkeleton: false,
            ...row.data,
        }))
    }, [loadableRows])

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

    // Build columns dynamically from row data
    const columns: ColumnsType<LoadableTableRow> = useMemo(() => {
        if (tableRows.length === 0) return []

        // Collect all unique keys from row data
        const keySet = new Set<string>()
        for (const row of tableRows) {
            if (row.data) {
                for (const key of Object.keys(row.data)) {
                    keySet.add(key)
                }
            }
        }

        // Build column definitions using SmartCellContent for consistent rendering
        return Array.from(keySet).map((key) => ({
            key,
            title: key,
            dataIndex: key,
            width: 200,
            ellipsis: true,
            render: (value: unknown, record: LoadableTableRow) => (
                <SmartCellContent value={value} keyPrefix={`${record.id}-${key}`} />
            ),
        }))
    }, [tableRows])

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
