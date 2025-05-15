import {useCallback, useEffect, useState} from "react"
import dynamic from "next/dynamic"

import {SortResult} from "@/oss/components/Filters/Sort"
import {Button, Input, Pagination, Radio, RadioChangeEvent, Space} from "antd"
import {ArrowClockwise, Database, Export} from "@phosphor-icons/react"
import {FILTER_COLUMNS} from "../constants"

import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {useObservabilityData} from "@/oss/contexts/observability.context"
import {getAppValues} from "@/oss/contexts/app.context"
import {getNodeById} from "@/oss/lib/helpers/observability_helpers"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {Filter, FilterConditions, KeyValuePair} from "@/oss/lib/Types"
import {TestsetTraceData} from "../../drawer/TestsetDrawer/assets/types"
import {ObservabilityHeaderProps} from "../types"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import clsx from "clsx"
import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"

const EditColumns = dynamic(() => import("@/oss/components/Filters/EditColumns"), {ssr: false})
const Filters = dynamic(() => import("@/oss/components/Filters/Filters"), {ssr: false})
const Sort = dynamic(() => import("@/oss/components/Filters/Sort"), {ssr: false})

const ObservabilityHeader = ({
    setEditColumns,
    selectedRowKeys,
    setTestsetDrawerData,
    editColumns,
    columns,
}: ObservabilityHeaderProps) => {
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
    const [isScrolled, setIsScrolled] = useState(false)

    const {
        traces,
        isLoading,
        count,
        searchQuery,
        setSearchQuery,
        traceTabs,
        setTraceTabs,
        filters,
        setFilters,
        sort,
        setSort,
        pagination,
        setPagination,
        fetchTraces,
    } = useObservabilityData()

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 180)
        }

        window.addEventListener("scroll", handleScroll)

        return () => {
            window.removeEventListener("scroll", handleScroll)
        }
    }, [])

    const handleToggleColumnVisibility = useCallback((key: string) => {
        setEditColumns((prev) =>
            prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
        )
    }, [])

    const updateFilter = useCallback(
        ({key, operator, value}: {key: string; operator: FilterConditions; value: string}) => {
            setFilters((prevFilters) => {
                const otherFilters = prevFilters.filter((f) => f.key !== key)
                return value ? [...otherFilters, {key, operator, value}] : otherFilters
            })
        },
        [setFilters],
    )

    const onSearchChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const query = e.target.value
            setSearchQuery(query)

            if (!query) {
                setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "content"))
            }
        },
        [setSearchQuery, setFilters],
    )

    const onSearchQueryApply = useCallback(() => {
        if (searchQuery) {
            updateFilter({key: "content", operator: "contains", value: searchQuery})
        }
    }, [searchQuery, updateFilter])

    const onSearchClear = useCallback(() => {
        const isSearchFilterExist = filters.some((item) => item.key === "content")

        if (isSearchFilterExist) {
            setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "content"))
        }
    }, [filters])

    // Sync searchQuery with filters state
    useLazyEffect(() => {
        const dataFilter = filters.find((f) => f.key === "content")
        setSearchQuery(dataFilter ? dataFilter.value : "")
    }, [filters])

    const onApplyFilter = useCallback((newFilters: Filter[]) => {
        setFilters(newFilters)
    }, [])

    const onClearFilter = useCallback((filter: Filter[]) => {
        setFilters(filter)
        setSearchQuery("")
        if (traceTabs === "chat") {
            setTraceTabs("tree")
        }
    }, [])

    const onTraceTabChange = useCallback(
        async (e: RadioChangeEvent) => {
            const selectedTab = e.target.value
            setTraceTabs(selectedTab)

            if (selectedTab === "chat") {
                updateFilter({key: "node.type", operator: "is", value: selectedTab})
            } else {
                const isNodeTypeFilterExist = filters.some(
                    (item) => item.key === "node.type" && item.value === "chat",
                )

                if (isNodeTypeFilterExist) {
                    setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "node.type"))
                }
            }
        },
        [filters, traceTabs, updateFilter],
    )

    // Sync traceTabs with filters state
    useLazyEffect(() => {
        const nodeTypeFilter = filters.find((f) => f.key === "node.type")?.value
        setTraceTabs((prev) =>
            nodeTypeFilter === "chat" ? "chat" : prev == "chat" ? "tree" : prev,
        )
    }, [filters])

    const onSortApply = useCallback(({type, sorted, customRange}: SortResult) => {
        setSort({type, sorted, customRange})
    }, [])

    const onPaginationChange = (current: number, pageSize: number) => {
        setPagination({size: pageSize, page: current})
    }
    // reset pagination to page 1 whenever quearies get updated
    useLazyEffect(() => {
        if (pagination.page > 1) {
            setPagination({...pagination, page: 1})
        }
    }, [filters, sort, traceTabs])

    const getTestsetTraceData = useCallback(() => {
        if (!traces?.length) return []

        const extractData = selectedRowKeys.map((key, idx) => {
            const node = getNodeById(traces, key as string)
            return {data: node?.data as KeyValuePair, key: node?.key, id: idx + 1}
        })

        if (extractData.length > 0) {
            setTestsetDrawerData(extractData as TestsetTraceData[])
        }
    }, [traces, selectedRowKeys])

    const onExport = useCallback(async () => {
        try {
            if (traces.length) {
                const {currentApp} = getAppValues()
                const filename = `${currentApp?.app_name || ""}_observability.csv`

                const convertToStringOrJson = (value: any) => {
                    return typeof value === "string" ? value : JSON.stringify(value)
                }

                // Helper function to create a trace object
                const createTraceObject = (trace: any) => ({
                    "Trace ID": trace.key,
                    Name: trace.node.name,
                    "Span type": trace.node.type || "N/A",
                    Inputs: convertToStringOrJson(trace?.data?.inputs) || "N/A",
                    Outputs: convertToStringOrJson(trace?.data?.outputs) || "N/A",
                    Duration: formatLatency(trace?.metrics?.acc?.duration.total / 1000),
                    Cost: formatCurrency(trace.metrics?.acc?.costs?.total),
                    Usage: formatTokenUsage(trace.metrics?.acc?.tokens?.total),
                    Timestamp: formatDay({
                        date: trace.time.start,
                        outputFormat: "HH:mm:ss DD MMM YYYY",
                    }),
                    Status: trace.status.code === "failed" ? "ERROR" : "SUCCESS",
                })

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
                                        className={clsx("mt-[0.8px]", {"animate-spin": isLoading})}
                                    />
                                }
                                onClick={() => fetchTraces()}
                                tooltipProps={{title: "Refresh data"}}
                            />
                        )}
                        <Input.Search
                            placeholder="Search"
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
                            columns={FILTER_COLUMNS}
                            onApplyFilter={onApplyFilter}
                            onClearFilter={onClearFilter}
                        />
                        <Sort onSortApply={onSortApply} defaultSortValue="1 month" />
                        {isScrolled && (
                            <>
                                <Space className="shrink-0 hidden xl:flex">
                                    <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                                        <Radio.Button value="tree">Root</Radio.Button>
                                        <Radio.Button value="chat">LLM</Radio.Button>
                                        <Radio.Button value="node">All</Radio.Button>
                                    </Radio.Group>
                                </Space>

                                <EnhancedButton
                                    onClick={() => getTestsetTraceData()}
                                    icon={<Database size={14} />}
                                    disabled={traces.length === 0 || selectedRowKeys.length === 0}
                                    tooltipProps={{title: "Add to test set"}}
                                />
                            </>
                        )}
                    </div>

                    <Pagination
                        simple
                        total={count}
                        align="end"
                        current={pagination.page}
                        pageSize={pagination.size}
                        onChange={onPaginationChange}
                        className="flex items-center xl:hidden shrink-0 [&_.ant-pagination-options]:hidden lg:[&_.ant-pagination-options]:block [&_.ant-pagination-options]:!ml-2"
                    />
                    <Pagination
                        total={count}
                        align="end"
                        current={pagination.page}
                        pageSize={pagination.size}
                        onChange={onPaginationChange}
                        className="hidden xl:flex xl:items-center"
                    />
                </div>
                {!isScrolled && (
                    <div className="w-full flex items-center justify-between">
                        <Space>
                            <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                                <Radio.Button value="tree">Root</Radio.Button>
                                <Radio.Button value="chat">LLM</Radio.Button>
                                <Radio.Button value="node">All</Radio.Button>
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
                                Add to test set
                            </Button>

                            <EditColumns
                                isOpen={isFilterColsDropdownOpen}
                                handleOpenChange={setIsFilterColsDropdownOpen}
                                selectedKeys={editColumns}
                                columns={columns}
                                onChange={handleToggleColumnVisibility}
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
