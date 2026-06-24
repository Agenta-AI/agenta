import type {ReactNode} from "react"
import {useCallback, useEffect, useMemo, useState} from "react"

import {
    querySimpleQueries,
    queryRevisionsForQueries,
    type QueryRevisionSummary,
} from "@agenta/entities/query"
import {projectIdAtom} from "@agenta/shared/state"
import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {useAtomValue} from "jotai"

import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"

import type {QueryRegistryStatus} from "../store/queryRegistryFilterAtoms"
import type {QueryRegistryRow} from "../store/queryRegistryStore"
import {
    getQueryRegistryTableState,
    queryRegistryRevisionsRefreshAtom,
} from "../store/queryRegistryStore"

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
    Boolean(row.__isRevisionChild || row.__isArchivedRevision)

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
    const revisionsRefresh = useAtomValue(queryRegistryRevisionsRefreshAtom)

    // Active-tab version history per query (batch-fetched, active revisions only):
    // drives the head-version badge + the expandable child rows.
    const [revisionsByQueryId, setRevisionsByQueryId] = useState<
        Record<string, QueryRevisionSummary[]>
    >({})
    // Archived-tab top-level rows for individually-archived revisions (of queries
    // that are themselves still active).
    const [archivedRevisionRows, setArchivedRevisionRows] = useState<QueryRegistryRow[]>([])
    const [expandedKeys, setExpandedKeys] = useState<string[]>([])

    // Drop caches on invalidation (commit/archive/restore) so the relevant fetch re-runs.
    useEffect(() => {
        if (revisionsRefresh === 0) return
        setRevisionsByQueryId({})
        setArchivedRevisionRows([])
    }, [revisionsRefresh])

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

    // ACTIVE tab: batch-fetch each visible query's active revision history.
    useEffect(() => {
        if (isArchived || !projectId) return
        const missing = headQueryIds.filter((id) => !(id in revisionsByQueryId))
        if (!missing.length) return
        let cancelled = false
        queryRevisionsForQueries({projectId, queryIds: missing})
            .then((revs) => {
                if (cancelled) return
                const grouped: Record<string, QueryRevisionSummary[]> = {}
                for (const id of missing) grouped[id] = []
                for (const rev of revs) (grouped[rev.queryId] ??= []).push(rev)
                setRevisionsByQueryId((prev) => ({...prev, ...grouped}))
            })
            .catch(() => {
                if (cancelled) return
                setRevisionsByQueryId((prev) => ({
                    ...prev,
                    ...Object.fromEntries(missing.map((id) => [id, prev[id] ?? []])),
                }))
            })
        return () => {
            cancelled = true
        }
    }, [isArchived, projectId, headQueryIds, revisionsByQueryId])

    // ARCHIVED tab: surface individually-archived revisions (of still-active queries)
    // as their own rows, alongside the archived queries the store already provides.
    useEffect(() => {
        if (!isArchived || !projectId) return
        let cancelled = false
        ;(async () => {
            try {
                const response = await querySimpleQueries({projectId, includeArchived: true})
                const all = response.queries ?? []
                const activeIds = all
                    .filter((q) => !q.deleted_at && q.id)
                    .map((q) => q.id as string)
                const nameById = new Map(all.map((q) => [q.id ?? "", q.name ?? q.slug ?? ""]))
                if (!activeIds.length) {
                    if (!cancelled) setArchivedRevisionRows([])
                    return
                }
                const revs = await queryRevisionsForQueries({
                    projectId,
                    queryIds: activeIds,
                    includeArchived: true,
                })
                if (cancelled) return
                const archivedRows: QueryRegistryRow[] = revs
                    .filter((rev) => rev.deletedAt && Number(rev.version ?? 0) > 0)
                    .map((rev) => ({
                        key: `arch-rev:${rev.revisionId}`,
                        queryId: rev.queryId,
                        variantId: null,
                        revisionId: rev.revisionId,
                        name: nameById.get(rev.queryId) || "Query",
                        slug: null,
                        filtering: rev.filtering,
                        windowing: null,
                        createdAt: rev.createdAt,
                        createdById: rev.createdById,
                        version: rev.version,
                        message: rev.message,
                        __isArchivedRevision: true,
                    }))
                setArchivedRevisionRows(archivedRows)
            } catch {
                if (!cancelled) setArchivedRevisionRows([])
            }
        })()
        return () => {
            cancelled = true
        }
    }, [isArchived, projectId, revisionsRefresh])

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
        // No expand toggle in the archived view — its rows are leaf items.
        () =>
            createQueryRegistryColumns(
                actions,
                fieldLabels,
                isArchived,
                isArchived ? undefined : expandState,
            ),
        [actions, fieldLabels, isArchived, expandState],
    )

    const dataSource = useMemo(() => {
        if (isArchived) {
            // Archived queries (from the store) + archived revisions, flat.
            return [...rows, ...archivedRevisionRows]
        }
        // Active: enrich each head row with its head version + revision children.
        return rows.map((row) => {
            if (row.__isSkeleton || !row.queryId) return row
            const revs = (revisionsByQueryId[row.queryId] ?? []).filter(
                (rev) => Number(rev.version ?? 0) > 0,
            )
            if (!revs.length) return row
            const head = revs[0]
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
                message: rev.message,
                __isRevisionChild: true,
            }))
            return {
                ...row,
                version: head.version ?? null,
                message: head.message ?? null,
                ...(children.length ? {children} : {}),
            }
        })
    }, [isArchived, rows, archivedRevisionRows, revisionsByQueryId])

    const treeExpandable = useMemo(
        () => ({
            expandedRowKeys: expandedKeys,
            expandIcon: () => null as unknown as null,
            rowExpandable: (record: QueryRegistryRow) =>
                !isArchived && !isRevisionRow(record) && !record.__isSkeleton,
        }),
        [expandedKeys, isArchived],
    )

    // Revision rows aren't selectable — hide their checkboxes.
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
