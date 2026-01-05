import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowsClockwiseIcon, DatabaseIcon, ExportIcon, TrashIcon} from "@phosphor-icons/react"
import {Button, Input, Radio, RadioChangeEvent, Space, Switch, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import dynamic from "next/dynamic"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import {SortResult} from "@/oss/components/Filters/Sort"
import {deleteTraceModalAtom} from "@/oss/components/SharedDrawers/TraceDrawer/components/DeleteTraceModal/store/atom"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {getNodeById} from "@/oss/lib/traces/observability_helpers"
import {Filter, FilterConditions, KeyValuePair} from "@/oss/lib/Types"
import {getAppValues} from "@/oss/state/app"
import {useObservability} from "@/oss/state/newObservability"
import {
    getAgData,
    getAgDataInputs,
    getAgDataOutputs,
    getCost,
    getLatency,
    getTokens,
} from "@/oss/state/newObservability/selectors/tracing"

import {buildAttributeKeyTreeOptions} from "../../assets/filters/attributeKeyOptions"
import getFilterColumns from "../../assets/getFilterColumns"
import {ObservabilityHeaderProps} from "../../assets/types"
import {AUTO_REFRESH_INTERVAL} from "../../constants"

const EditColumns = dynamic(() => import("@/oss/components/Filters/EditColumns"), {ssr: false})
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
    isScrolled?: boolean
    resetTrigger?: number
}> = ({checked, onChange, isScrolled, resetTrigger}) => {
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
                    Auto-refresh
                </Typography.Text>
                {checked && (
                    <div
                        className="absolute bottom-0 left-0 h-[2px] bg-gray-600 transition-all duration-100"
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
    const [isScrolled, setIsScrolled] = useState(false)
    const [internalRefreshTrigger, setInternalRefreshTrigger] = useState(0)
    const setDeleteModalState = useSetAtom(deleteTraceModalAtom)

    const {
        traces,
        isLoading: isTraceLoading,
        searchQuery,
        setSearchQuery,
        traceTabs,
        setTraceTabs,
        filters,
        setFilters,
        setSort,
        selectedRowKeys,
        setSelectedRowKeys,
        setTestsetDrawerData,
        setEditColumns,
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

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 180)
        }

        window.addEventListener("scroll", handleScroll)

        return () => {
            window.removeEventListener("scroll", handleScroll)
        }
    }, [])

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

    const onClearFilter = useCallback((filter: Filter[]) => {
        setFilters(filter)
        setSearchQuery("")
        if (traceTabs === "chat") {
            setTraceTabs("trace")
        }
    }, [])

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
        try {
            if (traces.length) {
                const {currentApp} = getAppValues()
                const filename = `${currentApp?.app_name || ""}_observability.csv`

                const convertToStringOrJson = (value: any) => {
                    return typeof value === "string" ? value : JSON.stringify(value)
                }

                // Helper function to create a trace object
                const createTraceObject = (trace: any) => {
                    const inputs = getAgDataInputs(trace)
                    const outputs = getAgDataOutputs(trace)
                    const duration = formatLatency(getLatency(trace))
                    const cost = formatCurrency(getCost(trace))
                    const usage = formatTokenUsage(getTokens(trace))

                    return {
                        "Trace ID": trace.trace_id,
                        Name: trace.span_name || "N/A",
                        "Span type": trace.span_type || "N/A",
                        Inputs: convertToStringOrJson(inputs) || "N/A",
                        Outputs: convertToStringOrJson(outputs) || "N/A",
                        Duration: duration,
                        Cost: cost,
                        Usage: usage,
                        Timestamp: formatDay({
                            date: trace.start_time,
                            inputFormat: "YYYY-MM-DDTHH:mm:ss.SSSSSS",
                            outputFormat: "HH:mm:ss DD MMM YYYY",
                        }),
                        Status: trace.status_code === "failed" ? "ERROR" : "SUCCESS",
                    }
                }

                const csvData = convertToCsv(
                    traces.flatMap((trace) => {
                        const parentTrace = createTraceObject(trace)
                        return trace.children && Array.isArray(trace.children)
                            ? [parentTrace, ...trace.children.map(createTraceObject)]
                            : [parentTrace]
                    }),
                    columns.map((col) => (col.title === "ID" ? "Trace ID" : (col.title as string))),
                )

                downloadCsv(csvData, filename)
            }
        } catch (error) {
            console.error("Export error:", error)
        }
    }, [traces, columns])

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

    return (
        <>
            <section
                className={clsx([
                    "flex justify-between gap-2 flex-col transition-all duration-200 ease-linear",
                    {
                        "!flex-row sticky top-2 z-10 bg-white py-2 px-2 border border-solid border-gray-200 rounded-lg mx-2 shadow-md":
                            isScrolled,
                        "translate-y-0 opacity-100": isScrolled,
                    },
                ])}
            >
                <div className="w-full flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-1">
                        {!isScrolled && (
                            <EnhancedButton
                                icon={
                                    <ArrowsClockwiseIcon
                                        size={14}
                                        className={clsx("mt-[0.8px]", {"animate-spin": isLoading})}
                                    />
                                }
                                onClick={handleRefresh}
                                tooltipProps={{title: "Refresh data"}}
                            />
                        )}
                        <Input.Search
                            placeholder="Search"
                            value={searchQuery}
                            onChange={onSearchChange}
                            onPressEnter={onSearchQueryApply}
                            onSearch={onSearchClear}
                            className={clsx("w-[320px] shrink-0", {
                                "!w-[200px] xl:!w-[260px]": isScrolled,
                            })}
                            allowClear
                        />

                        <Filters
                            filterData={filters}
                            columns={filterColumns}
                            onApplyFilter={onApplyFilter}
                            onClearFilter={onClearFilter}
                        />

                        <Sort onSortApply={onSortApply} defaultSortValue="24 hours" />

                        {!isScrolled && (
                            <AutoRefreshControl
                                checked={autoRefresh}
                                onChange={setAutoRefresh}
                                resetTrigger={refreshTrigger}
                            />
                        )}

                        {isScrolled && componentType === "traces" ? (
                            <>
                                <Space>
                                    <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                                        <Radio.Button value="trace">Root</Radio.Button>
                                        <Radio.Button value="chat">LLM</Radio.Button>
                                        <Radio.Button value="span">All</Radio.Button>
                                    </Radio.Group>
                                </Space>

                                <EnhancedButton
                                    onClick={() => getTestsetTraceData()}
                                    icon={<DatabaseIcon size={14} />}
                                    disabled={traces.length === 0 || selectedRowKeys.length === 0}
                                    tooltipProps={{title: "Add to testset"}}
                                />
                            </>
                        ) : null}
                        {isScrolled && componentType === "sessions" && setRealtimeMode ? (
                            <Space>
                                <Radio.Group
                                    value={realtimeMode ? "latest" : "all"}
                                    onChange={(e) => setRealtimeMode(e.target.value === "latest")}
                                    size="small"
                                >
                                    <Radio.Button value="all">All activity</Radio.Button>
                                    <Radio.Button value="latest">Latest activity</Radio.Button>
                                </Radio.Group>
                            </Space>
                        ) : null}

                        {isScrolled && (
                            <AutoRefreshControl
                                checked={autoRefresh}
                                onChange={setAutoRefresh}
                                isScrolled
                                resetTrigger={refreshTrigger}
                            />
                        )}
                    </div>
                </div>
                {!isScrolled && componentType === "traces" ? (
                    <div className="w-full flex items-center justify-between">
                        <Space>
                            <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                                <Radio.Button value="trace">Root</Radio.Button>
                                <Radio.Button value="chat">LLM</Radio.Button>
                                <Radio.Button value="span">All</Radio.Button>
                            </Radio.Group>
                        </Space>
                        <Space>
                            <Button
                                type="text"
                                onClick={onExport}
                                icon={<ExportIcon size={14} className="mt-0.5" />}
                                disabled={traces.length === 0}
                            >
                                Export
                            </Button>

                            <EditColumns
                                columns={columns}
                                uniqueKey="observability-table-columns"
                                onChange={(keys) => {
                                    setEditColumns(keys)
                                }}
                            />
                            <Button
                                onClick={onDelete}
                                icon={<TrashIcon size={14} />}
                                disabled={selectedRowKeys.length === 0}
                                danger
                            >
                                Delete
                            </Button>
                            <Button
                                onClick={() => getTestsetTraceData()}
                                icon={<DatabaseIcon size={14} />}
                                disabled={traces.length === 0 || selectedRowKeys.length === 0}
                            >
                                Add to testset
                            </Button>
                        </Space>
                    </div>
                ) : null}
                {!isScrolled && componentType === "sessions" && setRealtimeMode ? (
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
            {/* This element is to reduce the pixel shift of the table */}
            {isScrolled && <div className="w-full h-[10px]"></div>}
            <DeleteTraceModal />
        </>
    )
}

export default ObservabilityHeader
