import type {ReactNode} from "react"
import {useCallback, useEffect, useMemo, useState} from "react"

import {queryRevisionsForQueries, type QueryRevisionSummary} from "@agenta/entities/query"
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

const isRevisionRow = (row: QueryRegistryRow) => Boolean(row.__isRevisionChild)

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

    // Revision history per query, batch-fetched for the visible page (newest
    // first). Drives the parent's head-version badge + the expandable child rows.
    const [revisionsByQueryId, setRevisionsByQueryId] = useState<
        Record<string, QueryRevisionSummary[]>
    >({})
    const [expandedKeys, setExpandedKeys] = useState<string[]>([])

    // Row click opens the manage drawer, but not for revision rows.
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

    const rows = table.shellProps.pagination?.rows ?? []
    const headQueryIds = useMemo(
        () => rows.filter((row) => !row.__isSkeleton && row.queryId).map((row) => row.queryId),
        [rows],
    )

    // Batch-fetch revisions for any visible queries we haven't loaded yet.
    useEffect(() => {
        if (!projectId) return
        const missing = headQueryIds.filter((id) => !(id in revisionsByQueryId))
        if (!missing.length) return
        let cancelled = false
        queryRevisionsForQueries({projectId, queryIds: missing})
            .then((revs) => {
                if (cancelled) return
                // Seed each requested id (so we don't refetch) then group by query.
                const grouped: Record<string, QueryRevisionSummary[]> = {}
                for (const id of missing) grouped[id] = []
                for (const rev of revs) (grouped[rev.queryId] ??= []).push(rev)
                setRevisionsByQueryId((prev) => ({...prev, ...grouped}))
            })
            .catch(() => {
                if (cancelled) return
                // Mark as fetched-empty so a transient failure doesn't loop.
                setRevisionsByQueryId((prev) => ({
                    ...prev,
                    ...Object.fromEntries(missing.map((id) => [id, prev[id] ?? []])),
                }))
            })
        return () => {
            cancelled = true
        }
    }, [projectId, headQueryIds, revisionsByQueryId])

    const handleExpand = useCallback((expanded: boolean, record: QueryRegistryRow) => {
        setExpandedKeys((prev) =>
            expanded ? [...prev, record.key] : prev.filter((k) => k !== record.key),
        )
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

    // Enrich each head row with its head version + earlier-revision child rows.
    const dataSource = useMemo(
        () =>
            rows.map((row) => {
                if (row.__isSkeleton || !row.queryId) return row
                const revs = revisionsByQueryId[row.queryId]
                if (!revs?.length) return row
                const headVersion = revs[0]?.version ?? null
                const children: QueryRegistryRow[] = revs.slice(1).map((rev) => ({
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
                return {
                    ...row,
                    version: headVersion,
                    ...(children.length ? {children} : {}),
                }
            }),
        [rows, revisionsByQueryId],
    )

    const treeExpandable = useMemo(
        () => ({
            expandedRowKeys: expandedKeys,
            // Custom toggle in the Name cell renders the caret instead.
            expandIcon: () => null as unknown as null,
            rowExpandable: (record: QueryRegistryRow) =>
                !isRevisionRow(record) && !record.__isSkeleton,
        }),
        [expandedKeys],
    )

    // Revision (child) rows aren't selectable — hide their checkboxes.
    const rowSelection = useMemo(
        () =>
            ({
                ...table.shellProps.rowSelection,
                getCheckboxProps: (record: QueryRegistryRow) => ({
                    disabled: Boolean(record.__isSkeleton || isRevisionRow(record)),
                    style: isRevisionRow(record) ? {display: "none"} : undefined,
                }),
            }) as typeof table.shellProps.rowSelection,
        [table.shellProps.rowSelection],
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
            rowSelection={rowSelection}
            tableProps={{
                ...table.shellProps.tableProps,
                expandable: treeExpandable,
                ...(emptyState ? {locale: {emptyText: emptyState}} : {}),
            }}
        />
    )
}

export default QueryRegistryTable
