import type {Key, MouseEvent} from "react"
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom, useStore} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {activePreviewProjectIdAtom} from "@/oss/components/EvalRunDetails2/atoms/run"
import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable"
import useTableExport, {
    EXPORT_RESOLVE_SKIP,
    type TableExportColumnContext,
} from "@/oss/components/InfiniteVirtualTable/hooks/useTableExport"

import {shouldIgnoreRowClick} from "../../actions/navigationActions"
import {evaluationRunsTableFetchEnabledAtom} from "../../atoms/context"
import {evaluationRunsDatasetStore} from "../../atoms/tableStore"
import {
    evaluationRunsDeleteModalOpenAtom,
    evaluationRunsCreateModalOpenAtom,
    evaluationRunsMetaUpdaterAtom,
    evaluationRunsSelectedRowKeysAtom,
    evaluationRunsTableComponentSliceAtom,
    evaluationRunsTableResetAtom,
    evaluationRunsTableContextSetterAtom,
    evaluationRunsTablePageSizeAtom,
    evaluationRunsSelectionSnapshotAtom,
} from "../../atoms/view"
import useEvaluationRunNavigationActions from "../../hooks/useEvaluationRunNavigationActions"
import {
    useEvaluationRunsColumns,
    resolveReferenceExportValue,
} from "../../hooks/useEvaluationRunsColumns"
import type {EvaluationRunTableRow} from "../../types"
import type {
    EvaluationRunsColumnExportMetadata,
    MetricColumnExportMetadata,
} from "../../types/exportMetadata"
import {resolveRowAppId} from "../../utils/runHelpers"
import ColumnVisibilityPopoverContent from "../columnVisibility/ColumnVisibilityPopoverContent"
import RunsTableRow from "../common/RunsTableRow"
import EvaluationRunsCreateButton from "../EvaluationRunsCreateButton"
import EvaluationRunsDeleteButton from "../EvaluationRunsDeleteButton"
import EvaluationRunsHeaderFilters from "../filters/EvaluationRunsHeaderFilters"

import {ROW_HEIGHT} from "./assets/constants"
import {logExportAction} from "./export/helpers"
import {resolveMetricColumnExportLabel, resolveMetricExportValue} from "./export/metricResolvers"
import {resolveReferenceValueFromAtoms} from "./export/referenceResolvers"
import {resolveCreatedByExportValue, resolveRunNameFromSummary} from "./export/runResolvers"
import {EvaluationRunsTableProps} from "./types"

const NewEvaluationModal = dynamic(
    () => import("@/oss/components/pages/evaluations/NewEvaluation"),
    {
        ssr: false,
    },
)
const OnlineEvaluationDrawer = dynamic(
    () => import("@/oss/components/pages/evaluations/onlineEvaluation/OnlineEvaluationDrawer"),
    {ssr: false},
)
const InactiveTablePlaceholder = ({className}: {className?: string}) => (
    <div className={clsx("flex h-full min-h-0 flex-col gap-4", className)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="h-6 w-32 rounded bg-gray-100" />
            <div className="flex gap-2">
                <div className="h-8 w-20 rounded bg-gray-100" />
                <div className="h-8 w-28 rounded bg-gray-100" />
            </div>
        </div>
        <div className="flex-1 min-h-0 rounded border border-dashed text-sm text-gray-500">
            <div className="flex h-full items-center justify-center">Preparing tab…</div>
        </div>
    </div>
)

const EvaluationRunsTablePOC = ({
    active = true,
    pageSize = 15,
    includePreview = true,
    appId = null,
    projectIdOverride = null,
    manageContextOverrides = true,
    ...rest
}: EvaluationRunsTableProps) => {
    const setOverrides = useSetAtom(evaluationRunsTableContextSetterAtom)
    const setPageSize = useSetAtom(evaluationRunsTablePageSizeAtom)
    const setFetchEnabled = useSetAtom(evaluationRunsTableFetchEnabledAtom)

    useEffect(() => {
        if (!manageContextOverrides) return
        setOverrides({
            appId,
            projectIdOverride,
            includePreview,
            evaluationKind: rest.evaluationKind,
        })
    }, [
        appId,
        includePreview,
        manageContextOverrides,
        projectIdOverride,
        rest.evaluationKind,
        setOverrides,
    ])

    useEffect(() => {
        if (!manageContextOverrides) return
        setPageSize(pageSize)
    }, [manageContextOverrides, pageSize, setPageSize])

    useEffect(() => {
        if (!manageContextOverrides) return
        setFetchEnabled(active)
        return () => {
            if (!manageContextOverrides) return
            setFetchEnabled(false)
        }
    }, [active, manageContextOverrides, setFetchEnabled])

    const router = useRouter()
    const isEvaluationsPath = router.asPath.includes("/evaluations")

    useEffect(() => {
        if (!manageContextOverrides) return
        setFetchEnabled(isEvaluationsPath ? active : false)
    }, [active, isEvaluationsPath, manageContextOverrides, setFetchEnabled])

    useEffect(() => {
        if (!manageContextOverrides) return
        const handleStart = (url: string) => {
            if (url.includes("/evaluations")) return
            setFetchEnabled(false)
        }
        const handleComplete = (url: string) => {
            setFetchEnabled(url.includes("/evaluations") ? active : false)
        }
        router.events.on("routeChangeStart", handleStart)
        router.events.on("routeChangeComplete", handleComplete)
        return () => {
            router.events.off("routeChangeStart", handleStart)
            router.events.off("routeChangeComplete", handleComplete)
        }
    }, [active, manageContextOverrides, router.events, setFetchEnabled])

    if (!active) {
        return <InactiveTablePlaceholder className={rest.className} />
    }

    return <EvaluationRunsTableActive {...rest} pageSize={pageSize} />
}

const EvaluationRunsTableActive = ({
    pageSize = 15,
    evaluationKind,
    className,
    showFilters = true,
    enableInfiniteScroll = true,
    autoHeight = true,
    headerTitle,
}: EvaluationRunsTableProps) => {
    const {
        projectId: contextProjectId,
        scope,
        scopeId,
        isAutoOrHuman,
        supportsPreviewMetrics,
        activeAppId,
        storageKey,
        createSupported,
        createEvaluationType,
    } = useAtomValue(evaluationRunsTableComponentSliceAtom)
    const setMetaUpdater = useSetAtom(evaluationRunsMetaUpdaterAtom)
    const setResetCallback = useSetAtom(evaluationRunsTableResetAtom)
    const setActivePreviewProjectId = useSetAtom(activePreviewProjectIdAtom)
    const [isCreateModalOpen, setIsCreateModalOpen] = useAtom(evaluationRunsCreateModalOpenAtom)
    const [selectedRowKeys, setSelectedRowKeys] = useAtom(evaluationRunsSelectedRowKeysAtom)
    const [rowExportingKey, setRowExportingKey] = useState<string | null>(null)
    const setDeleteModalOpen = useSetAtom(evaluationRunsDeleteModalOpenAtom)
    const selectionSnapshot = useAtomValue(evaluationRunsSelectionSnapshotAtom)
    const store = useStore()
    const tableExport = useTableExport<EvaluationRunTableRow>()
    const columnsRef = useRef<ReturnType<typeof useEvaluationRunsColumns> | null>(null)

    const resolveRowAppIdForScope = useCallback(
        (record: EvaluationRunTableRow): string | null =>
            resolveRowAppId(record, activeAppId ?? null),
        [activeAppId],
    )

    const {handleOpenRun, handleVariantNavigation, handleTestsetNavigation} =
        useEvaluationRunNavigationActions({scope, evaluationKind})

    const handleRequestDelete = useCallback(
        (record: EvaluationRunTableRow, options?: {preserveSelection?: boolean}) => {
            if (!record || record.__isSkeleton || !record.key) return
            if (!options?.preserveSelection) {
                setSelectedRowKeys([record.key])
            }
            setDeleteModalOpen(true)
        },
        [setDeleteModalOpen, setSelectedRowKeys],
    )

    const pagination = evaluationRunsDatasetStore.hooks.usePagination({
        scopeId,
        pageSize,
        resetOnScopeChange: false,
    })
    const {rows: displayedRows, loadNextPage, resetPages} = pagination

    const buildRowHandlers = useCallback(
        (record: EvaluationRunTableRow) => {
            const runId = record.preview?.id ?? record.runId
            const isNavigable = Boolean(!record.__isSkeleton && runId)
            return {
                onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                    if (shouldIgnoreRowClick(event)) return
                    if (!isNavigable) return
                    handleOpenRun(record)
                },
                className: clsx("evaluation-runs-table__row", {
                    "opacity-60 animate-pulse": record.__isSkeleton,
                }),
                style: {
                    cursor: isNavigable ? "pointer" : "default",
                    height: ROW_HEIGHT,
                    minHeight: ROW_HEIGHT,
                },
            }
        },
        [handleOpenRun],
    )

    useEffect(() => {
        setActivePreviewProjectId(contextProjectId ?? null)
        return () => {
            setActivePreviewProjectId(null)
        }
    }, [contextProjectId, setActivePreviewProjectId])

    useEffect(() => {
        setResetCallback(() => resetPages)
        return () => {
            setResetCallback(null)
        }
    }, [resetPages, setResetCallback])

    const rowSelectionConfig = useMemo(
        () => ({
            type: "checkbox" as const,
            selectedRowKeys,
            onChange: (keys: Key[], _rows: EvaluationRunTableRow[]) => {
                setSelectedRowKeys(keys)
            },
            getCheckboxProps: (record: EvaluationRunTableRow) => ({
                disabled: Boolean(record.__isSkeleton),
            }),
            columnWidth: 36,
            fixed: true,
        }),
        [selectedRowKeys, setSelectedRowKeys],
    )

    const closeCreateModal = useCallback(() => {
        setIsCreateModalOpen(false)
    }, [setIsCreateModalOpen])

    const handleCreateSuccess = useCallback(() => {
        setIsCreateModalOpen(false)
        resetPages()
        setMetaUpdater((prev) => ({...prev}))
    }, [resetPages, setIsCreateModalOpen, setMetaUpdater])

    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            sticky: true,
            bordered: true,
            virtual: autoHeight,
            tableLayout: "fixed" as const,
            components: {
                body: {
                    row: RunsTableRow,
                },
            },
            onRow: buildRowHandlers,
        }),
        [autoHeight, buildRowHandlers],
    )

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId,
            pageSize,
            columnVisibilityStorageKey: storageKey,
            enableInfiniteScroll,
        }),
        [enableInfiniteScroll, pageSize, scopeId, storageKey],
    )

    const tablePagination = useMemo<TableFeaturePagination<EvaluationRunTableRow>>(
        () => ({
            rows: displayedRows,
            loadNextPage,
            resetPages,
        }),
        [displayedRows, loadNextPage, resetPages],
    )

    const handlePaginationStateChange = useCallback(
        ({resetPages: nextReset}: {resetPages: () => void; loadNextPage: () => void}) => {
            setResetCallback(() => nextReset)
        },
        [setResetCallback],
    )

    const exportResolveValue = useCallback(
        async ({column, row}: {column: any; row: EvaluationRunTableRow}): Promise<unknown> => {
            const metadata = column?.exportMetadata as
                | EvaluationRunsColumnExportMetadata
                | undefined
            if (!metadata || !row?.key) return EXPORT_RESOLVE_SKIP
            if (metadata.type === "reference") {
                const resolved = resolveReferenceValueFromAtoms(
                    store,
                    row,
                    metadata.descriptor,
                    contextProjectId ?? null,
                )
                if (resolved !== undefined) {
                    return resolved
                }
                logExportAction("falling back to preview metadata for reference export", {
                    rowKey: row.key,
                    column: metadata.descriptor.label,
                    role: metadata.descriptor.role,
                })
                return resolveReferenceExportValue(row, metadata.descriptor)
            }
            if (metadata.type === "metric") {
                return resolveMetricExportValue(store, row, metadata.descriptor)
            }
            if (metadata.type === "createdBy") {
                return resolveCreatedByExportValue(store, row)
            }
            if (metadata.type === "runName") {
                return resolveRunNameFromSummary(store, row, contextProjectId ?? null)
            }
            return EXPORT_RESOLVE_SKIP
        },
        [contextProjectId, store],
    )

    const resolveColumnLabel = useCallback(
        ({column}: TableExportColumnContext<EvaluationRunTableRow>) => {
            const metadata = column?.exportMetadata as
                | EvaluationRunsColumnExportMetadata
                | undefined
            if (!metadata || metadata.type !== "metric") {
                return undefined
            }
            const metricMetadata = metadata as MetricColumnExportMetadata
            return resolveMetricColumnExportLabel(
                store,
                metricMetadata.descriptor,
                metricMetadata.groupLabel ?? null,
            )
        },
        [store],
    )

    const filtersNode = useMemo(
        () => (showFilters ? <EvaluationRunsHeaderFilters /> : null),
        [showFilters],
    )
    const createButton = useMemo(
        () => (createSupported ? <EvaluationRunsCreateButton /> : null),
        [createSupported],
    )
    const deleteButton = useMemo(() => <EvaluationRunsDeleteButton />, [])

    const fallbackControlsHeight = showFilters ? 96 : headerTitle ? 48 : 24

    const handleExportRow = useCallback(
        async (record: EvaluationRunTableRow) => {
            if (!record || record.__isSkeleton || !record.key) return
            const snapshot = columnsRef.current
            if (!snapshot?.length) {
                console.warn("[EvaluationRunsTable] Cannot export row without columns")
                return
            }
            const sanitizedKey = record.key.replace(/[^a-zA-Z0-9-_]+/g, "-")
            setRowExportingKey(record.key)
            try {
                await tableExport({
                    columns: snapshot,
                    rows: [record],
                    filename: `evaluation-run-${sanitizedKey}.csv`,
                    resolveValue: exportResolveValue,
                    resolveColumnLabel,
                })
            } catch (error) {
                console.error("[EvaluationRunsTable] Failed to export row", error)
            } finally {
                setRowExportingKey((current) => (current === record.key ? null : current))
            }
        },
        [exportResolveValue, resolveColumnLabel, tableExport],
    )

    const infiniteTableKeyboardShortcuts = useMemo(
        () => ({
            selection: {
                navigation: false,
                range: false,
            },
            rows: {
                highlightClassName: "evaluation-runs-table__row--highlighted",
                highlightOnHover: false,
                toggleSelectionWithSpace: true,
                onOpen: ({record}: {record: EvaluationRunTableRow}) => {
                    handleOpenRun(record)
                },
                onDelete: ({
                    record,
                    selected,
                    selection,
                }: {
                    record: EvaluationRunTableRow
                    selected: boolean
                    selection: Key[]
                }) => {
                    const shouldPreserve = selected && selection.length > 1
                    handleRequestDelete(record, {preserveSelection: shouldPreserve})
                },
                onExport: ({
                    record,
                    selection,
                }: {
                    key: Key | null
                    record: EvaluationRunTableRow | null
                    selection: Key[]
                }) => {
                    if (selection.length > 0) {
                        const exportButton = document.querySelector<HTMLButtonElement>(
                            ".evaluation-runs-table__export",
                        )
                        exportButton?.click()
                        return
                    }
                    if (record) {
                        void handleExportRow(record)
                    }
                },
            },
        }),
        [handleExportRow, handleOpenRun, handleRequestDelete],
    )

    const renderExportButton = useCallback(
        ({onExport, loading}: {onExport: () => void; loading: boolean}) => {
            const disabled = !selectionSnapshot.hasSelection
            const tooltip = disabled ? "Select runs to export" : undefined
            return (
                <Tooltip title={tooltip}>
                    <span>
                        <Button
                            className="evaluation-runs-table__export"
                            disabled={disabled}
                            onClick={onExport}
                            loading={loading}
                        >
                            Export CSV
                        </Button>
                    </span>
                </Tooltip>
            )
        },
        [selectionSnapshot.hasSelection],
    )

    const exportOptions = useMemo(
        () => ({
            resolveValue: exportResolveValue,
            resolveColumnLabel,
        }),
        [exportResolveValue, resolveColumnLabel],
    )

    const columns = useEvaluationRunsColumns({
        evaluationKind,
        rows: displayedRows,
        scopeId,
        supportsPreviewMetrics,
        isAutoOrHuman,
        onOpenDetails: handleOpenRun,
        onVariantNavigation: handleVariantNavigation,
        onTestsetNavigation: handleTestsetNavigation,
        onRequestDelete: handleRequestDelete,
        resolveAppId: resolveRowAppIdForScope,
        onExportRow: handleExportRow,
        rowExportingKey,
    })

    useEffect(() => {
        columnsRef.current = columns
    }, [columns])

    return (
        <div
            className={clsx("flex flex-col", autoHeight ? "h-full min-h-0" : "min-h-0", className)}
        >
            <InfiniteVirtualTableFeatureShell<EvaluationRunTableRow>
                key={scopeId ?? "evaluation-runs-table"}
                datasetStore={evaluationRunsDatasetStore}
                tableScope={tableScope}
                columns={columns}
                rowKey={(record) => record.key}
                title={headerTitle}
                filters={filtersNode}
                primaryActions={createButton}
                secondaryActions={deleteButton}
                autoHeight={autoHeight}
                rowHeight={ROW_HEIGHT}
                fallbackControlsHeight={fallbackControlsHeight}
                fallbackHeaderHeight={48}
                tableClassName="agenta-scenario-table"
                tableProps={tableProps}
                rowSelection={rowSelectionConfig}
                className="flex-1 min-h-0"
                columnVisibilityMenuRenderer={(ctrls, close) => (
                    <ColumnVisibilityPopoverContent controls={ctrls} onClose={close} />
                )}
                pagination={tablePagination}
                onPaginationStateChange={handlePaginationStateChange}
                exportOptions={exportOptions}
                renderExportButton={renderExportButton}
                keyboardShortcuts={infiniteTableKeyboardShortcuts}
            />

            {createSupported ? (
                createEvaluationType === "online" ? (
                    <OnlineEvaluationDrawer
                        open={isCreateModalOpen}
                        onClose={closeCreateModal}
                        onCreate={handleCreateSuccess}
                    />
                ) : (
                    <NewEvaluationModal
                        preview
                        open={isCreateModalOpen}
                        evaluationType={createEvaluationType}
                        onCancel={closeCreateModal}
                        onSuccess={handleCreateSuccess}
                    />
                )
            ) : null}
        </div>
    )
}

export default EvaluationRunsTablePOC
