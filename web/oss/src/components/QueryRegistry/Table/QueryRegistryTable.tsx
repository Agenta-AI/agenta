import type {ReactNode} from "react"
import {useCallback, useMemo, useState} from "react"

import {queryQueryRevisions} from "@agenta/entities/query"
import {projectIdAtom} from "@agenta/shared/state"
import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {useAtomValue} from "jotai"

import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"

import type {QueryRegistryStatus} from "../store/queryRegistryFilterAtoms"
import type {QueryRegistryRow} from "../store/queryRegistryStore"
import {getQueryRegistryTableState} from "../store/queryRegistryStore"

import {
    buildFieldLabelMap,
    createQueryRegistryColumns,
    type QueryColumnActions,
} from "./assets/queryRegistryColumns"

interface QueryRegistryTableProps {
    actions: QueryColumnActions
    onRowClick?: (record: QueryRegistryRow) => void
    filters?: ReactNode
    primaryActions?: ReactNode
    /** Rendered by the antd Table when there are no rows (post-load). */
    emptyState?: ReactNode
    searchDeps?: unknown[]
    /** Active vs archived view — selects the store and the restore-only actions. */
    mode?: QueryRegistryStatus
}

const isRevisionRow = (row: QueryRegistryRow) =>
    Boolean(row.__isRevisionChild || row.__isRevisionLoader)

const loaderRow = (row: QueryRegistryRow): QueryRegistryRow => ({
    key: `${row.queryId}__rev-loader`,
    queryId: row.queryId,
    variantId: row.variantId,
    revisionId: null,
    name: "",
    slug: null,
    filtering: null,
    windowing: null,
    createdAt: null,
    createdById: null,
    __isRevisionLoader: true,
})

const emptyHistoryRow = (row: QueryRegistryRow): QueryRegistryRow => ({
    ...loaderRow(row),
    key: `${row.queryId}__rev-empty`,
    name: "No earlier versions",
    __isRevisionLoader: false,
    __isRevisionChild: true,
})

const QueryRegistryTable = ({
    actions,
    onRowClick,
    filters,
    primaryActions,
    emptyState,
    searchDeps = [],
    mode = "active",
}: QueryRegistryTableProps) => {
    const isArchived = mode === "archived"
    const projectId = useAtomValue(projectIdAtom)
    const datasetStore = getQueryRegistryTableState(mode).store

    // Lazily-loaded revision history per query (the version-history expand).
    const [childrenByQueryId, setChildrenByQueryId] = useState<Record<string, QueryRegistryRow[]>>(
        {},
    )
    const [expandedKeys, setExpandedKeys] = useState<string[]>([])

    // Row click opens the manage drawer, but not for revision/loader rows.
    const handleRowClick = useCallback(
        (record: QueryRegistryRow) => {
            if (isRevisionRow(record)) return
            onRowClick?.(record)
        },
        [onRowClick],
    )

    const table = useTableManager<QueryRegistryRow>({
        datasetStore: datasetStore as never,
        scopeId: isArchived ? "query-registry-archived" : "query-registry",
        pageSize: 50,
        onRowClick: handleRowClick,
        searchDeps,
        columnVisibilityStorageKey: isArchived
            ? "agenta:query-registry-archived:column-visibility"
            : "agenta:query-registry:column-visibility",
    })

    const fetchRevisions = useCallback(
        async (row: QueryRegistryRow) => {
            if (!projectId || childrenByQueryId[row.queryId]) return
            try {
                const revisions = await queryQueryRevisions({projectId, queryId: row.queryId})
                // Drop the head revision (already shown as the parent row) — children
                // are the earlier versions only.
                const children: QueryRegistryRow[] = revisions
                    .filter((rev) => rev.revisionId !== row.revisionId)
                    .map((rev) => ({
                        key: rev.revisionId || `${row.queryId}:${rev.version}`,
                        queryId: row.queryId,
                        variantId: row.variantId,
                        revisionId: rev.revisionId,
                        name: row.name,
                        slug: row.slug,
                        filtering: rev.filtering,
                        windowing: null,
                        createdAt: rev.createdAt,
                        createdById: rev.createdById,
                        version: rev.version,
                        __isRevisionChild: true,
                    }))
                setChildrenByQueryId((prev) => ({
                    ...prev,
                    [row.queryId]: children.length ? children : [emptyHistoryRow(row)],
                }))
            } catch {
                setChildrenByQueryId((prev) => ({
                    ...prev,
                    [row.queryId]: [emptyHistoryRow(row)],
                }))
            }
        },
        [projectId, childrenByQueryId],
    )

    const handleExpand = useCallback((expanded: boolean, rowKey: string) => {
        setExpandedKeys((prev) => (expanded ? [...prev, rowKey] : prev.filter((k) => k !== rowKey)))
    }, [])

    const expandState = useMemo(
        () => ({expandedRowKeys: expandedKeys, handleExpand}),
        [expandedKeys, handleExpand],
    )

    const fieldLabels = useMemo(() => buildFieldLabelMap(getFilterColumns()), [])
    const columns = useMemo(
        () => createQueryRegistryColumns(actions, fieldLabels, isArchived, expandState),
        [actions, fieldLabels, isArchived, expandState],
    )

    // Attach lazily-loaded revision rows (or a loader placeholder) as antd tree
    // children so the virtual table renders the expanded history inline.
    const rows = table.shellProps.pagination?.rows ?? []
    const dataSource = useMemo(
        () =>
            rows.map((row) => {
                if (row.__isSkeleton || !row.queryId) return row
                return {...row, children: childrenByQueryId[row.queryId] ?? [loaderRow(row)]}
            }),
        [rows, childrenByQueryId],
    )

    const treeExpandable = useMemo(
        () => ({
            expandedRowKeys: expandedKeys,
            // Drive the fetch off expansion; the toggle lives in the Name cell.
            onExpand: (expanded: boolean, record: QueryRegistryRow) => {
                if (expanded) void fetchRevisions(record)
            },
            // Custom toggle in the Name cell renders the caret instead.
            expandIcon: () => null as unknown as null,
            rowExpandable: (record: QueryRegistryRow) =>
                !isRevisionRow(record) && !record.__isSkeleton,
        }),
        [expandedKeys, fetchRevisions],
    )

    return (
        <InfiniteVirtualTableFeatureShell<QueryRegistryRow>
            {...table.shellProps}
            useSettingsDropdown
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            className="flex-1 min-h-0"
            autoHeight
            dataSource={dataSource}
            tableProps={{
                ...table.shellProps.tableProps,
                expandable: treeExpandable,
                ...(emptyState ? {locale: {emptyText: emptyState}} : {}),
            }}
        />
    )
}

export default QueryRegistryTable
