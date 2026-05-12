import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {ArrowsClockwiseIcon, ExportIcon, TrashIcon} from "@phosphor-icons/react"
import {Button, Input, Radio, RadioChangeEvent, Space, Switch, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import {SortResult} from "@/oss/components/Filters/Sort"
import AddActionsDropdown from "@/oss/components/SharedActions/AddActionsDropdown"
import {deleteTraceModalAtom} from "@/oss/components/SharedDrawers/TraceDrawer/components/DeleteTraceModal/store/atom"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import {downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {getNodeById} from "@/oss/lib/traces/observability_helpers"
import {Filter, FilterConditions, KeyValuePair} from "@/oss/lib/Types"
import {getAppValues} from "@/oss/state/app"
import {useObservability} from "@/oss/state/newObservability"
import {
    buildTraceQueryParams,
    fetchAllTracesForExport,
} from "@/oss/state/newObservability/atoms/queryHelpers"
import {getAgData} from "@/oss/state/newObservability/selectors/tracing"

import {createTraceObject, DEFAULT_TRACE_EXPORT_HEADERS} from "../../assets/exportUtils"
import {buildAttributeKeyTreeOptions} from "../../assets/filters/attributeKeyOptions"
import getFilterColumns from "../../assets/getFilterColumns"
import {ObservabilityHeaderProps} from "../../assets/types"
import {AUTO_REFRESH_INTERVAL} from "../../constants"

const Filters = dynamic(() => import("@/oss/components/Filters/Filters"), {ssr: false})
const Sort = dynamic(() => import("@/oss/components/Filters/Sort"), {ssr: false})

const DeleteTraceModal = dynamic(
    () => import("@/oss/components/SharedDrawers/TraceDrawer/components/DeleteTraceModal"),
    {
        ssr: false,
    },
)

const AutoRefreshControl: React.FC<{
    checked: boolean
    onChange: (checked: boolean) => void
    resetTrigger?: number
}> = ({checked, onChange, resetTrigger}) => {
    const [progress, setProgress] = useState(0)
    const [key, setKey] = useState(0)

    // Reset animation when resetTrigger changes
    useEffect(() => {
        if (checked && resetTrigger !== undefined) {
            setProgress(0)
            setKey((prev) => prev + 1)
        }
    }, [resetTrigger, checked])

    useEffect(() => {
        if (!checked) {
            setProgress(0)
            return
        }

        // Start fresh animation
        setProgress(0)

        const startTime = Date.now()
        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime
            const newProgress = Math.min((elapsed / AUTO_REFRESH_INTERVAL) * 100, 100)
            setProgress(newProgress)
        }, 100) // Update every 100ms for smooth animation

        return () => clearInterval(interval)
    }, [checked, key])

    return (
        <Space size="small" className="ml-4">
            <Switch size="small" checked={checked} onChange={onChange} />
            <div className="relative inline-block">
                <Typography.Text style={{fontSize: 12}} className="text-gray-600">
                    auto-refresh
                </Typography.Text>
                {checked && (
                    <div
                        className="absolute bottom-0 left-0 h-[2px] bg-gray-600 transition-[width] duration-100"
                        style={{width: `${progress}%`}}
                    />
                )}
            </div>
        </Space>
    )
}

const ObservabilityHeader = ({
    columns,
    componentType,
    isLoading: propsLoading,
    onRefresh,
    realtimeMode,
    setRealtimeMode,
    autoRefresh: propsAutoRefresh,
    setAutoRefresh: propsSetAutoRefresh,
    refreshTrigger: propsRefreshTrigger,
}: ObservabilityHeaderProps) => {
    const [internalRefreshTrigger, setInternalRefreshTrigger] = useState(0)
    const [isExporting, setIsExporting] = useState(false)
    const exportAbortRef = useRef<AbortController | null>(null)
    const setDeleteModalState = useSetAtom(deleteTraceModalAtom)
    const {canExportData} = useProjectPermissions()

    const {
        traces,
        isLoading: isTraceLoading,
        searchQuery,
        setSearchQuery,
        traceTabs,
        setTraceTabs,
        filters,
        setFilters,
        sort,
        setSort,
        selectedRowKeys,
        setSelectedRowKeys,
        setTestsetDrawerData,
        fetchAnnotations,
        fetchTraces,
        autoRefresh: hookAutoRefresh,
        setAutoRefresh: hookSetAutoRefresh,
    } = useObservability()
    const queryClient = useAtomValue(queryClientAtom)

    // Use props if provided (sessions), otherwise use hook (traces)
    const autoRefresh = propsAutoRefresh ?? hookAutoRefresh
    const setAutoRefresh = propsSetAutoRefresh ?? hookSetAutoRefresh

    const isLoading = propsLoading || isTraceLoading
    const attributeKeyOptions = useMemo(() => buildAttributeKeyTreeOptions(traces), [traces])
    const filterColumns = useMemo(
        () => getFilterColumns(attributeKeyOptions),
        [attributeKeyOptions],
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

    useEffect(
        () => () => {
            exportAbortRef.current?.abort()
        },
        [],
    )

    const updateFilter = useCallback(
        ({field, operator, value}: {field: string; operator: FilterConditions; value: string}) => {
            setFilters((prevFilters) => {
                const otherFilters = prevFilters.filter((f) => f.field !== field)
                return value ? [...otherFilters, {field, operator, value}] : otherFilters
            })
        },
        [setFilters],
    )

    const onSearchChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const query = e.target.value
            setSearchQuery(query)

            if (!query) {
                setFilters((prevFilters) => prevFilters.filter((f) => f.field !== "content"))
            }
        },
        [setSearchQuery, setFilters],
    )

    const onSearchQueryApply = useCallback(() => {
        if (searchQuery) {
            updateFilter({
                field: "content",
                operator: "contains",
                value: searchQuery,
            })
        }
    }, [searchQuery, updateFilter])

    const onSearchClear = useCallback(() => {
        const isSearchFilterExist = filters.some((item) => item.field === "content")

        if (isSearchFilterExist) {
            setFilters((prevFilters) => prevFilters.filter((f) => f.field !== "content"))
        }
    }, [filters])

    // Sync searchQuery with filters state
    useLazyEffect(() => {
        const dataFilter = filters.find((f) => f.field === "content")
        setSearchQuery(dataFilter && typeof dataFilter.value === "string" ? dataFilter.value : "")
    }, [filters])

    const onApplyFilter = useCallback((newFilters: Filter[]) => {
        setFilters(newFilters)
    }, [])

    const onClearFilter = useCallback(
        (filter: Filter[]) => {
            setFilters(filter)
            setSearchQuery("")
            if (traceTabs === "chat") {
                setTraceTabs("trace")
            }
        },
        [setFilters, setSearchQuery, setTraceTabs, traceTabs],
    )

    const onTraceTabChange = useCallback(
        (e: RadioChangeEvent) => {
            const selectedTab = e.target.value
            queryClient.removeQueries({queryKey: ["tracing"]})
            setTraceTabs(selectedTab)

            if (selectedTab === "chat") {
                updateFilter({
                    field: "span_type",
                    operator: "is",
                    value: selectedTab,
                })
            } else {
                const isSpanTypeFilterExist = filters.some(
                    (item) => item.field === "span_type" && item.value === "chat",
                )

                if (isSpanTypeFilterExist) {
                    setFilters((prevFilters) => prevFilters.filter((f) => f.field !== "span_type"))
                }
            }
        },
        [filters, updateFilter, queryClient, setTraceTabs, setFilters],
    )

    // Sync traceTabs with filters state
    useLazyEffect(() => {
        const spanTypeFilter = filters.find((f) => f.field === "span_type")?.value
        setTraceTabs((prev) =>
            spanTypeFilter === "chat" ? "chat" : prev == "chat" ? "trace" : prev,
        )
    }, [filters])

    const onSortApply = useCallback(({type, sorted, customRange}: SortResult) => {
        setSort({type, sorted, customRange})
    }, [])

    const getTestsetTraceData = useCallback(() => {
        if (!traces?.length) return []

        const extractData = selectedRowKeys.map((key, idx) => {
            const node = getNodeById(traces, key as string)
            return {data: getAgData(node) as KeyValuePair, key: node?.key, id: idx + 1}
        })

        if (extractData.length > 0) {
            setTestsetDrawerData(extractData)
        }
    }, [traces, selectedRowKeys, setTestsetDrawerData])

    const onExport = useCallback(async () => {
        const exportKey = "observability-export"

        try {
            if (!canExportData) return
            if (!traces.length) return

            const {currentApp} = getAppValues()
            const appId = currentApp?.id || ""
            const filename = `${currentApp?.name ?? currentApp?.slug ?? ""}_observability.csv`

            const {
                params,
                hasAnnotationConditions,
                hasAnnotationOperator,
                isHasAnnotationSelected,
            } = buildTraceQueryParams(filters, sort, traceTabs, undefined)

            const headers =
                columns
                    .map((col) => {
                        if (col.title === "ID") return "Trace ID"
                        return typeof col.title === "string" ? col.title : null
                    })
                    .filter((header): header is string => Boolean(header)) || []

            const controller = new AbortController()
            exportAbortRef.current = controller

            setIsExporting(true)
            message.loading({
                content: "Preparing export",
                key: exportKey,
                duration: 0,
            })

            const {csvParts, rowCount, limitReached} = await fetchAllTracesForExport({
                params,
                appId,
                isHasAnnotationSelected,
                hasAnnotationConditions,
                hasAnnotationOperator,
                formatRow: createTraceObject,
                headers: headers.length > 0 ? headers : DEFAULT_TRACE_EXPORT_HEADERS,
                signal: controller.signal,
                onProgress: (count) => {
                    message.loading({
                        content: `Exporting ${count.toLocaleString()} rows`,
                        key: exportKey,
                        duration: 0,
                    })
                },
            })

            if (!rowCount) {
                message.info({
                    content: "No traces to export",
                    key: exportKey,
                })

                return
            }

            downloadCsv(csvParts, filename)

            if (limitReached) {
                message.warning({
                    content: `Export limit reached. Downloaded first ${rowCount.toLocaleString()} rows.`,
                    key: exportKey,
                    duration: 5,
                })
            } else {
                message.success({
                    content: `Exported ${rowCount.toLocaleString()} rows`,
                    key: exportKey,
                })
            }
        } catch (error) {
            if ((error as Error).name === "AbortError") {
                message.info({
                    content: "Export cancelled",
                    key: exportKey,
                })

                return
            }

            console.error("Export error:", error)
            message.error({
                content: "Export failed",
                key: exportKey,
            })
        } finally {
            exportAbortRef.current = null
            setIsExporting(false)
        }
    }, [canExportData, columns, filters, sort, traceTabs, traces])

    const handleRefresh = async () => {
        if (componentType === "sessions") {
            await onRefresh?.()
        } else {
            await Promise.all([fetchAnnotations(), fetchTraces()])
        }
        setInternalRefreshTrigger((prev) => prev + 1)
    }

    // Use external refresh trigger if provided (from parent auto-refresh), otherwise use internal
    const refreshTrigger = propsRefreshTrigger ?? internalRefreshTrigger

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

    const handleExportClick = useCallback(() => {
        if (isExporting) {
            exportAbortRef.current?.abort()
            return
        }

        void onExport()
    }, [isExporting, onExport])

    const renderTraceSecondaryActions = (size: "small" | "middle" = "middle") => {
        if (componentType !== "traces") return null

        return (
            <Space size="small">
                {canExportData ? (
                    <Button
                        type="text"
                        size={size}
                        aria-label={isExporting ? "Cancel export" : "Export traces"}
                        onClick={handleExportClick}
                        icon={<ExportIcon size={14} />}
                        disabled={!isExporting && traces.length === 0}
                    >
                        {isExporting ? "Cancel export" : "Export"}
                    </Button>
                ) : null}
                <Tooltip
                    title={selectedRowKeys.length === 0 ? "Select traces to delete" : undefined}
                >
                    <span>
                        <Button
                            type="text"
                            size={size}
                            danger
                            aria-label="Delete selected traces"
                            onClick={onDelete}
                            icon={<TrashIcon size={14} />}
                            disabled={selectedRowKeys.length === 0}
                        >
                            Delete
                        </Button>
                    </span>
                </Tooltip>
            </Space>
        )
    }

    return (
        <>
            <section className="flex justify-between gap-2 flex-col">
                <div className="w-full flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-1">
                        <EnhancedButton
                            aria-label="Refresh data"
                            icon={
                                <ArrowsClockwiseIcon
                                    size={14}
                                    className={clsx("mt-[0.8px]", {"animate-spin": isLoading})}
                                />
                            }
                            onClick={handleRefresh}
                            tooltipProps={{title: "Refresh data"}}
                        />
                        <Input.Search
                            aria-label="Search observability data"
                            placeholder="Search"
                            value={searchQuery}
                            onChange={onSearchChange}
                            onPressEnter={onSearchQueryApply}
                            onSearch={onSearchClear}
                            className="w-[320px] shrink-0"
                            allowClear
                        />

                        <Filters
                            filterData={filters}
                            columns={filterColumns}
                            onApplyFilter={onApplyFilter}
                            onClearFilter={onClearFilter}
                        />

                        <Sort onSortApply={onSortApply} defaultSortValue="24 hours" />

                        <AutoRefreshControl
                            checked={autoRefresh}
                            onChange={setAutoRefresh}
                            resetTrigger={refreshTrigger}
                        />
                    </div>
                </div>
                {componentType === "traces" ? (
                    <div className="w-full flex items-center justify-between">
                        <Space>
                            <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                                <Radio.Button value="trace">Root</Radio.Button>
                                <Radio.Button value="chat">LLM</Radio.Button>
                                <Radio.Button value="span">All</Radio.Button>
                            </Radio.Group>
                        </Space>
                        <Space>
                            {renderTraceSecondaryActions()}
                            <AddActionsDropdown
                                dataTour="create-testset-button"
                                testsetAction={{
                                    onSelect: getTestsetTraceData,
                                    disabled: traces.length === 0 || selectedRowKeys.length === 0,
                                }}
                                queueAction={{
                                    itemType: "traces",
                                    itemIds: selectedTraceIds,
                                    disabled: traces.length === 0 || selectedTraceIds.length === 0,
                                    onItemsAdded: handleQueueItemsAdded,
                                }}
                            />
                        </Space>
                    </div>
                ) : null}
                {componentType === "sessions" && setRealtimeMode ? (
                    <div className="w-full flex items-center justify-end">
                        <Space>
                            <Radio.Group
                                value={realtimeMode ? "latest" : "all"}
                                onChange={(e) => setRealtimeMode(e.target.value === "latest")}
                            >
                                <Radio.Button value="all">All activity</Radio.Button>
                                <Radio.Button value="latest">Latest activity</Radio.Button>
                            </Radio.Group>
                        </Space>
                    </div>
                ) : null}
            </section>
            <DeleteTraceModal />
        </>
    )
}

export default ObservabilityHeader
