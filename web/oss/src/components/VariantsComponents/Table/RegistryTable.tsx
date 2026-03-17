import type {ReactNode} from "react"
import {useCallback, useMemo, useState} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"

import type {RegistryRevisionRow} from "../store/registryStore"
import {registryPaginatedStore} from "../store/registryStore"

import {createRegistryColumns, type RegistryColumnActions} from "./assets/registryColumns"

interface RegistryTableProps {
    onRowClick?: (record: RegistryRevisionRow) => void
    actions: RegistryColumnActions
    searchDeps?: unknown[]
    scopeId?: string
    pageSize?: number
    columnVisibilityStorageKey?: string
    filters?: ReactNode
    primaryActions?: ReactNode
    displayMode?: "flat" | "grouped"
}

// ============================================================================
// GROUPED VIEW HELPERS
// ============================================================================

interface VariantGroup {
    representative: RegistryRevisionRow
    revisions: RegistryRevisionRow[]
}

function groupByVariant(rows: RegistryRevisionRow[]): VariantGroup[] {
    const map = new Map<string, VariantGroup>()
    for (const row of rows) {
        if (row.__isSkeleton) continue
        const existing = map.get(row.variantId)
        if (existing) {
            existing.revisions.push(row)
        } else {
            map.set(row.variantId, {representative: row, revisions: [row]})
        }
    }
    return Array.from(map.values())
}

// ============================================================================
// REGISTRY TABLE
// ============================================================================

const RegistryTable = ({
    onRowClick,
    actions,
    searchDeps = [],
    scopeId = "registry-revisions",
    pageSize = 50,
    columnVisibilityStorageKey = "agenta:registry:column-visibility",
    filters,
    primaryActions,
    displayMode = "flat",
}: RegistryTableProps) => {
    // Track which variant groups are expanded
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])

    const handleExpand = useCallback((expanded: boolean, record: RegistryRevisionRow) => {
        const rowKey = String(record.key)
        // Only parent group rows can be expanded
        if (record.__isGroupChild) return

        if (expanded) {
            setExpandedRowKeys((prev) => [...prev, rowKey])
        } else {
            setExpandedRowKeys((prev) => prev.filter((k) => k !== rowKey))
        }
    }, [])

    const table = useTableManager<RegistryRevisionRow>({
        datasetStore: registryPaginatedStore.store as never,
        scopeId,
        pageSize,
        onRowClick,
        searchDeps,
        columnVisibilityStorageKey,
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(
        () => createRegistryColumns(actions, {expandedRowKeys, handleExpand}),
        [actions, expandedRowKeys, handleExpand],
    )

    const paginationRows = table.shellProps.pagination?.rows ?? []

    // Grouped view: build parent rows with `children` property for Ant Design tree data
    const groupedDataSource = useMemo(() => {
        if (displayMode !== "grouped") return undefined

        // During loading, skeleton rows are present — pass them through as-is
        // so the table shows a loading state instead of "No data"
        const hasOnlySkeletons =
            paginationRows.length > 0 && paginationRows.every((r) => r.__isSkeleton)
        if (hasOnlySkeletons) return paginationRows

        const groups = groupByVariant(paginationRows)
        return groups.map((group) => {
            // Exclude the representative (latest) revision from children — it's the parent row
            const childRevisions = group.revisions.filter(
                (rev) => rev.key !== group.representative.key,
            )
            const children: RegistryRevisionRow[] = childRevisions.map((rev) => ({
                ...rev,
                __isGroupChild: true,
            }))

            // Parent row uses representative (latest revision) data + children
            return {
                ...group.representative,
                key: `variant-group-${group.representative.variantId}`,
                __isVariantGroup: true,
                __revisionCount: group.revisions.length,
                children,
            }
        })
    }, [displayMode, paginationRows])

    // Tree expandable config — hides default expand column (icon is in Name cell)
    const treeExpandable = useMemo(() => {
        if (displayMode !== "grouped") return undefined
        return {
            expandedRowKeys,
            onExpand: handleExpand,
            expandIcon: () => null,
        }
    }, [displayMode, expandedRowKeys, handleExpand])

    return (
        <InfiniteVirtualTableFeatureShell<RegistryRevisionRow>
            {...table.shellProps}
            useSettingsDropdown
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            autoHeight
            dataSource={groupedDataSource}
            tableProps={{
                ...table.shellProps.tableProps,
                ...(treeExpandable ? {expandable: treeExpandable} : {}),
            }}
        />
    )
}

export default RegistryTable
