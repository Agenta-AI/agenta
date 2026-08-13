import {useCallback, useMemo} from "react"

import type {SimpleQueue} from "@agenta/entities/simpleQueue"
import {getNodeById} from "@agenta/entities/trace"
import {invalidateEvaluatorsListCache} from "@agenta/entities/workflow"
import {
    buildAttributeKeyTreeOptions,
    buildTraceQueryParams,
    fieldConfigByOptionKey,
    getAgData,
    getFilterColumns,
    reconcileFilterRows,
} from "@agenta/observability"
import type {Filter as PackagedFilter} from "@agenta/observability"
import type {FilterItem} from "@agenta/observability/filters"
import {
    ObservabilityRangePicker,
    ObservabilityToolbar,
    useTracesExport,
} from "@agenta/observability-ui"
import {projectIdAtom} from "@agenta/shared/state"
import {modal} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import AnnotatedFilterDialog from "@/oss/components/Filters/AnnotatedFilterDialog"
import {FILTER_COLUMN_ICONS} from "@/oss/components/pages/observability/assets/filterColumnIcons"
import AddActionsDropdown from "@/oss/components/SharedActions/AddActionsDropdown"
import type {TestsetTraceData} from "@/oss/components/SharedDrawers/AddToTestsetDrawer/assets/types"
import {deleteTraceModalAtom} from "@/oss/components/SharedDrawers/TraceDrawer/components/DeleteTraceModal/store/atom"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {KeyValuePair} from "@/oss/lib/Types"
import {getAppValues} from "@/oss/state/app"
import {useObservability} from "@/oss/state/observability"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

import {ObservabilityHeaderProps} from "../../assets/types"

import {useBatchAddTracesToQueue} from "./useBatchAddTracesToQueue"

const DeleteTraceModal = dynamic(
    () => import("@/oss/components/SharedDrawers/TraceDrawer/components/DeleteTraceModal"),
    {
        ssr: false,
    },
)

/**
 * The observability / sessions chrome. The controls themselves live in
 * `@agenta/observability-ui`'s `ObservabilityToolbar`; this file keeps the app-only wiring —
 * the CSV export pipeline, the delete modal, the add-to-testset / add-to-queue menu, and the
 * filter dialog's column set — and hands them down as slots and callbacks.
 */
const ObservabilityHeader = ({
    columns,
    componentType,
    isLoading: propsLoading,
    onRefresh,
    refreshTrigger,
}: ObservabilityHeaderProps) => {
    const setDeleteModalState = useSetAtom(deleteTraceModalAtom)
    const {canExportData} = useProjectPermissions()
    const projectId = useAtomValue(projectIdAtom)

    const {
        traces,
        isLoading: isTraceLoading,
        setSearchQuery,
        traceTabs,
        setTraceTabs,
        filters,
        setFilters,
        sort,
        selectedRowKeys,
        setSelectedRowKeys,
        setTestsetDrawerData,
        fetchAnnotations,
        fetchTraces,
    } = useObservability()
    const runBatchAdd = useBatchAddTracesToQueue()

    const {onExport: handleExportClick, isExporting} = useTracesExport({
        columns,
        canExportData,
        resolveAppId: () => getAppValues().currentApp?.id || "",
        resolveFilename: () => {
            const {currentApp} = getAppValues()
            return `${currentApp?.name ?? currentApp?.slug ?? ""}_observability.csv`
        },
    })

    const isLoading = propsLoading || isTraceLoading
    const attributeKeyOptions = useMemo(() => buildAttributeKeyTreeOptions(traces), [traces])
    const filterColumns = useMemo(
        () => getFilterColumns(attributeKeyOptions, FILTER_COLUMN_ICONS),
        [attributeKeyOptions],
    )

    // The label flip itself is a pure projection in @agenta/observability; this
    // only binds it to the current workflow kind and field map.
    const workflowKind = useAtomValue(currentWorkflowContextAtom).workflowKind
    const filterFieldMap = useMemo(() => fieldConfigByOptionKey(filterColumns), [filterColumns])
    const reconcileRows = useCallback(
        (rows: FilterItem[]): FilterItem[] =>
            reconcileFilterRows(rows, workflowKind, filterFieldMap),
        [workflowKind, filterFieldMap],
    )
    const selectedTraceIds = useMemo(
        () =>
            Array.from(
                new Set(
                    selectedRowKeys
                        .map((key) => getNodeById(traces, String(key))?.trace_id || "")
                        .filter((traceId): traceId is string => Boolean(traceId)),
                ),
            ),
        [traces, selectedRowKeys],
    )

    const onApplyFilter = useCallback(
        (newFilters: PackagedFilter[]) => {
            setFilters(newFilters)
        },
        [setFilters],
    )

    const onClearFilter = useCallback(
        (filter: PackagedFilter[]) => {
            setFilters(filter)
            setSearchQuery("")
            if (traceTabs === "chat") {
                setTraceTabs("trace")
            }
        },
        [setFilters, setSearchQuery, setTraceTabs, traceTabs],
    )

    const getTestsetTraceData = useCallback(() => {
        if (!traces?.length) return []

        const extractData = selectedRowKeys.map((key, idx) => {
            const node = getNodeById(traces, key as string)
            return {data: getAgData(node ?? undefined) as KeyValuePair, key: node?.key, id: idx + 1}
        })

        if (extractData.length > 0) {
            // Latent: `key` can be undefined when a selected row is no longer in `traces`.
            setTestsetDrawerData(extractData as TestsetTraceData[])
        }
    }, [traces, selectedRowKeys, setTestsetDrawerData])

    const handleRefresh = useCallback(async () => {
        if (componentType === "sessions") {
            await onRefresh?.()
        } else {
            await Promise.all([fetchAnnotations(), fetchTraces()])
            invalidateEvaluatorsListCache()
        }
    }, [componentType, onRefresh, fetchAnnotations, fetchTraces])

    const onDelete = useCallback(() => {
        setDeleteModalState({
            isOpen: true,
            traceIds: Array.from(
                new Set(
                    traces
                        .filter((trace) => selectedRowKeys.includes(trace.span_id))
                        .map((trace) => trace.trace_id),
                ),
            ),
            onClose: () => {
                setSelectedRowKeys([])
                handleRefresh()
            },
        })
    }, [traces, selectedRowKeys, setDeleteModalState, setSelectedRowKeys, handleRefresh])

    const handleQueueItemsAdded = useCallback(() => {
        setSelectedRowKeys([])
    }, [setSelectedRowKeys])

    // Filter-scoped queue add — gate the picker. With a filter active, go
    // straight to it; with no filter, confirm (this queues the whole project).
    const onAddAllMatchingBeforeOpen = useCallback(async () => {
        if (filters.length > 0) return true
        return await new Promise<boolean>((resolve) => {
            modal.confirm({
                title: "Add every trace to the queue?",
                content:
                    "No filter is active — this will queue every trace in the project. Continue?",
                okText: "Continue",
                cancelText: "Cancel",
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            })
        })
    }, [filters])

    // Filter-scoped queue add — the picked queue runs a background scan of
    // every trace matching the current observability filter. The hook owns
    // its own rate-limit toast UI, so we hand it the raw scan params and
    // let it build the adaptive fetcher itself.
    const onAddAllMatchingQueueSelected = useCallback(
        (queue: SimpleQueue) => {
            const {currentApp} = getAppValues()
            const appId = currentApp?.id || ""
            const {
                params,
                hasAnnotationConditions,
                hasAnnotationOperator,
                isHasAnnotationSelected,
            } = buildTraceQueryParams(filters, sort, traceTabs, undefined)
            const projectURL = window.location.pathname.match(/^(\/w\/[^/]+\/p\/[^/]+)/)?.[1]
            runBatchAdd({
                queue,
                scanConfig: {
                    params,
                    appId,
                    projectId: projectId ?? "",
                    isHasAnnotationSelected,
                    hasAnnotationConditions,
                    hasAnnotationOperator,
                },
                viewQueueUrl: projectURL ? `${projectURL}/annotations/${queue.id}` : undefined,
            })
        },
        [filters, sort, traceTabs, runBatchAdd, projectId],
    )

    const filtersSlot = useMemo(
        () => (
            <AnnotatedFilterDialog
                filterData={filters}
                columns={filterColumns}
                onApplyFilter={onApplyFilter}
                onClearFilter={onClearFilter}
                reconcileFilterRows={reconcileRows}
            />
        ),
        [filters, filterColumns, onApplyFilter, onClearFilter, reconcileRows],
    )

    const actionsSlot = useMemo(
        () =>
            componentType === "traces" ? (
                <AddActionsDropdown
                    dataTour="create-testset-button"
                    testsetAction={{
                        onSelect: getTestsetTraceData,
                        disabled: traces.length === 0 || selectedRowKeys.length === 0,
                    }}
                    queueAction={{
                        itemType: "traces",
                        itemIds: selectedTraceIds,
                        label:
                            selectedTraceIds.length > 0
                                ? `Add ${selectedTraceIds.length} selected to queue`
                                : "Add selected to queue",
                        disabled: traces.length === 0 || selectedTraceIds.length === 0,
                        onItemsAdded: handleQueueItemsAdded,
                    }}
                    queueAllMatchingAction={{
                        label: "Add all matching filter to queue",
                        disabled: traces.length === 0,
                        onBeforeOpen: onAddAllMatchingBeforeOpen,
                        onQueueSelected: onAddAllMatchingQueueSelected,
                    }}
                />
            ) : null,
        [
            componentType,
            getTestsetTraceData,
            traces.length,
            selectedRowKeys.length,
            selectedTraceIds,
            handleQueueItemsAdded,
            onAddAllMatchingBeforeOpen,
            onAddAllMatchingQueueSelected,
        ],
    )

    return (
        <>
            <ObservabilityToolbar
                componentType={componentType}
                isLoading={isLoading}
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
                onExport={
                    componentType === "traces" && canExportData ? handleExportClick : undefined
                }
                isExporting={isExporting}
                onDelete={componentType === "traces" ? onDelete : undefined}
                filtersSlot={filtersSlot}
                sortSlot={<ObservabilityRangePicker />}
                actionsSlot={actionsSlot}
            />
            <DeleteTraceModal />
        </>
    )
}

export default ObservabilityHeader
