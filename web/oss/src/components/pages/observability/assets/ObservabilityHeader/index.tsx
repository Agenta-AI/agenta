import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowClockwise, Database, Export} from "@phosphor-icons/react"
import {Button, Input, Radio, RadioChangeEvent, Space} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import dynamic from "next/dynamic"

import {SortResult} from "@/oss/components/Filters/Sort"
import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
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

import {buildAttributeKeyTreeOptions} from "../filters/attributeKeyOptions"
import getFilterColumns from "../getFilterColumns"
import {ObservabilityHeaderProps} from "../types"

const EditColumns = dynamic(() => import("@/oss/components/Filters/EditColumns"), {ssr: false})
const Filters = dynamic(() => import("@/oss/components/Filters/Filters"), {ssr: false})
const Sort = dynamic(() => import("@/oss/components/Filters/Sort"), {ssr: false})

const ObservabilityHeader = ({columns}: ObservabilityHeaderProps) => {
    const [isScrolled, setIsScrolled] = useState(false)
    const [isRefreshButtonLoading, setIsRefreshButtonLoading] = useState(false)

    const {
        traces,
        isLoading,
        searchQuery,
        setSearchQuery,
        traceTabs,
        setTraceTabs,
        filters,
        setFilters,
        setSort,
        selectedRowKeys,
        setTestsetDrawerData,
        setEditColumns,
    } = useObservability()
    const queryClient = useAtomValue(queryClientAtom)

    const isRefreshLoading = isLoading || isRefreshButtonLoading

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

    const onReloadTraces = useCallback(() => {
        // intentional implementation to force show loading state when faster refreshes occur
        setIsRefreshButtonLoading(true)
        setTimeout(() => {
            setIsRefreshButtonLoading(false)
        }, 400)

        queryClient.invalidateQueries({queryKey: ["traces"]})
        queryClient.invalidateQueries({queryKey: ["annotations"]})
    }, [setIsRefreshButtonLoading, queryClient])

    return (
        <>
            <section
                className={clsx([
                    "flex justify-between gap-3 flex-col transition-all duration-200 ease-linear",
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
                                    <ArrowClockwise
                                        size={14}
                                        className={clsx("mt-[0.8px]", {
                                            "animate-spin": isRefreshLoading,
                                        })}
                                    />
                                }
                                onClick={onReloadTraces}
                                tooltipProps={{title: "Refresh data"}}
                                loading={isRefreshLoading}
                            />
                        )}
                        <Input.Search
                            placeholder="Full-text search"
                            value={searchQuery}
                            onChange={onSearchChange}
                            onPressEnter={onSearchQueryApply}
                            onSearch={onSearchClear}
                            className={clsx("w-[220px] xl:w-[300px] shrink-0", {
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
                        {isScrolled && (
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
                                    icon={<Database size={14} />}
                                    disabled={traces.length === 0 || selectedRowKeys.length === 0}
                                    tooltipProps={{title: "Add to testset"}}
                                />
                            </>
                        )}
                    </div>
                </div>
                {!isScrolled && (
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
                                icon={<Export size={14} className="mt-0.5" />}
                                disabled={traces.length === 0}
                            >
                                Export as CSV
                            </Button>

                            <Button
                                onClick={() => getTestsetTraceData()}
                                icon={<Database size={14} />}
                                disabled={traces.length === 0 || selectedRowKeys.length === 0}
                            >
                                Add to testset
                            </Button>

                            <EditColumns
                                columns={columns}
                                uniqueKey="observability-table-columns"
                                onChange={(keys) => {
                                    setEditColumns(keys)
                                }}
                            />
                        </Space>
                    </div>
                )}
            </section>
            {/* This element is to reduce the pixel shift of the table */}
            {isScrolled && <div className="w-full h-[10px]"></div>}{" "}
        </>
    )
}

export default ObservabilityHeader
