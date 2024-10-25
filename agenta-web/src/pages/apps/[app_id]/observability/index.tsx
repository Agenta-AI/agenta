import GenericDrawer from "@/components/GenericDrawer"
import {nodeTypeStyles} from "@/components/pages/observability/components/AvatarTreeContent"
import StatusRenderer from "@/components/pages/observability/components/StatusRenderer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import Filters from "@/components/Filters/Filters"
import Sort from "@/components/Filters/Sort"
import EditColumns from "@/components/Filters/EditColumns"
import ResultTag from "@/components/ResultTag/ResultTag"
import {ResizableTitle} from "@/components/ServerTable/components"
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {getNodeById} from "@/lib/helpers/observability_helpers"
import {useTraces} from "@/lib/hooks/useTraces"
import {Filter, FilterConditions, JSSTheme, SortTypes} from "@/lib/Types"
import {_AgentaRootsResponse, AgentaRootsResponse} from "@/services/observability/types"
import {
    Button,
    Input,
    Radio,
    RadioChangeEvent,
    Space,
    Table,
    TableColumnType,
    Typography,
} from "antd"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import {Export} from "@phosphor-icons/react"
import {getAppValues} from "@/contexts/app.context"
import {convertToCsv, downloadCsv} from "@/lib/helpers/fileManipulations"
import axios from "@/lib/helpers/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {observabilityTransformer} from "@/services/observability/core"
import {useUpdateEffect} from "usehooks-ts"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

interface Props {}

const ObservabilityDashboard = ({}: Props) => {
    const classes = useStyles()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")
    const [searchQuery, setSearchQuery] = useState("")
    const [traceTabs, setTraceTabs] = useState("all")
    const [editColumns, setEditColumns] = useState<string[]>([])
    const [filters, setFilters] = useState<Filter[]>([])
    const [isExportLoading, setIsExportLoading] = useState(false)
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
    const {traces} = useTraces()
    const [columns, setColumns] = useState<ColumnsType<_AgentaRootsResponse>>([
        {
            title: "ID",
            dataIndex: ["key"],
            key: "key",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            fixed: "left",
            render: (_, record) => {
                const {icon: Icon} = nodeTypeStyles[record.node.type ?? "default"]

                return !record.parent ? (
                    <ResultTag value1={`# ${record.key.split("-")[0]}`} />
                ) : (
                    <Space align="center" size={4}>
                        <div className="grid place-items-center">
                            <Icon size={16} />
                        </div>
                        <Typography>{record.node.name}</Typography>
                    </Space>
                )
            },
        },
        {
            title: "Timestamp",
            key: "timestamp",
            dataIndex: ["time", "start"],
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return <div>{dayjs(record.time.start).format("HH:mm:ss DD MMM YYYY")}</div>
            },
        },
        {
            title: "Inputs",
            key: "inputs",
            width: 350,
            onHeaderCell: () => ({
                style: {minWidth: 350},
            }),
        },
        {
            title: "Outputs",
            key: "outputs",
            width: 350,
            onHeaderCell: () => ({
                style: {minWidth: 350},
            }),
        },
        {
            title: "Status",
            key: "status",
            dataIndex: ["status", "code"],
            width: 160,
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => StatusRenderer({status: record.status, showMore: true}),
        },
        {
            title: "Latency",
            key: "latency",
            dataIndex: ["time", "span"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => <div>{formatLatency(record.time.span / 1000000)}</div>,
        },
        {
            title: "Usage",
            key: "usage",
            dataIndex: ["metrics", "acc", "tokens", "total"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => (
                <div>{formatTokenUsage(record.metrics?.acc?.tokens?.total)}</div>
            ),
        },
        {
            title: "Total cost",
            key: "total_cost",
            dataIndex: ["metrics", "acc", "costs", "total"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => <div>{formatCurrency(record.metrics?.acc?.costs?.total)}</div>,
        },
    ])

    const activeTraceIndex = useMemo(
        () => traces?.findIndex((item) => item.root.id === selectedTraceId),
        [selectedTraceId, traces],
    )

    const activeTrace = useMemo(() => traces[activeTraceIndex] ?? null, [activeTraceIndex, traces])

    const [selected, setSelected] = useState(activeTrace?.key)

    const selectedItem = useMemo(
        () => (traces?.length ? getNodeById(traces, selected) : null),
        [selected, traces],
    )

    useEffect(() => {
        setSelected(activeTrace?.key)
    }, [activeTrace])

    const handleResize =
        (key: string) =>
        (_: any, {size}: {size: {width: number}}) => {
            setColumns((cols) => {
                return cols.map((col) => ({
                    ...col,
                    width: col.key === key ? size.width : col.width,
                }))
            })
        }

    const mergedColumns = useMemo(() => {
        return columns.map((col) => ({
            ...col,
            width: col.width || 200,
            onHeaderCell: (column: TableColumnType<_AgentaRootsResponse>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
        }))
    }, [columns])

    // external codes
    // ----------------------------------------------------------------------

    const onExport = async () => {
        try {
            setIsExportLoading(true)

            if (traces.length) {
                const {currentApp} = getAppValues()
                const filename = `${currentApp?.app_name}_observability.csv`

                // Helper function to create a trace object
                const createTraceObject = (trace: any) => ({
                    "Trace ID": trace.key,
                    Timestamp: dayjs(trace.time.start).format("HH:mm:ss DD MMM YYYY"),
                    Inputs: trace?.data?.inputs?.topic || "N/A",
                    Outputs: JSON.stringify(trace?.data?.outputs) || "N/A",
                    Status: trace.status.code,
                    Latency: formatLatency(trace.time.span / 1000000),
                    Usage: formatTokenUsage(trace?.metrics?.acc?.tokens?.total || 0),
                    "Total cost": formatCurrency(trace?.metrics?.acc?.costs?.total || 0),
                    "Span ID": trace.node.id,
                    "Span Type": trace.node.type || "N/A",
                })

                const csvData = convertToCsv(
                    traces.flatMap((trace) => {
                        const parentTrace = createTraceObject(trace)
                        const childrenTraces = trace.children.map(createTraceObject)
                        return [parentTrace, ...childrenTraces]
                    }),
                    [
                        ...columns.map((col) =>
                            col.title === "ID" ? "Trace ID" : (col.title as string),
                        ),
                        "Span ID",
                        "Span Type",
                    ],
                )

                downloadCsv(csvData, filename)
            }
        } catch (error) {
            console.error("Export error:", error)
        } finally {
            setIsExportLoading(false)
        }
    }

    const filterColumns = [
        {value: "data", label: "data"},
        {value: "status.code", label: "status.code"},
        {value: "metrics.acc.costs.total", label: "metrics.acc.costs.total"},
        {value: "metrics.acc.tokens.total", label: "metrics.acc.tokens.total"},
        {value: "node.name", label: "node.name"},
        {value: "node.type", label: "node.type"},
    ]

    const onSortApply = async ({
        sortData,
        customSortData,
    }: {
        sortData: SortTypes
        customSortData?: any
    }) => {
        // let time
        // let query: string
        // if (sortData !== "custom" && sortData) {
        //     const now = dayjs().utc() // Get the current UTC time
        //     if (sortData === "all time") {
        //         time = "1970-01-01T00:00:00"
        //         query = `&earliest=${time}`
        //         return
        //     }
        //     // Split the value into number and unit (e.g., "30 minutes" becomes ["30", "minutes"])
        //     const [amount, unit] = sortData.split(" ")
        //     time = now
        //         .subtract(parseInt(amount), unit as dayjs.ManipulateType)
        //         .toISOString()
        //         .split(".")[0]
        //     query = `&earliest=${time}`
        // }
        // if (customSortData?.startTime && sortData == "custom") {
        //     query = `earliest=${customSortData.startTime.toISOString().split(".")[0]}&latest=${customSortData.endTime.toISOString().split(".")[0]}`
        // }
        // try {
        //     const fetchAllTraces = async () => {
        //         const response = await axios.get(
        //             `${getAgentaApiUrl()}/api/observability/v1/traces/search?project_id=0192c229-3760-759d-a637-959921135050&${query}`,
        //         )
        //         return response.data
        //     }
        //     const data = await fetchAllTraces()
        //     setTraces(
        //         data.trees.flatMap((item: AgentaRootsResponse) =>
        //             // @ts-ignore
        //             observabilityTransformer(item),
        //         ) as _AgentaRootsResponse[],
        //     )
        // } catch (error) {
        //     console.log(error)
        // }
    }

    const handleToggleColumnVisibility = (key: string) => {
        setEditColumns((prev) =>
            prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
        )
    }

    // without synchronization code - version 1
    // ------------------------------------------------------------------------

    // const onFilterApply = (filter: Filter[]) => {
    //     try {
    //         const query = `&filtering={"conditions": ${JSON.stringify(filter)}}`
    //         console.log(query)
    //     } catch (error) {}
    // }

    // const onClearFilter = async (filter: Filter[]) => {}

    // const onSearchQueryAppy = async () => {
    //     if (!searchQuery) return
    //     try {
    //         const query = `filtering={"conditions":[{"key":"data","value":"${searchQuery}","operator":"contains"}]}`

    //         const fetchAllTraces = async () => {
    //             const response = await axios.get(
    //                 `${getAgentaApiUrl()}/api/observability/v1/traces/search?project_id=0192c229-3760-759d-a637-959921135050&${query}`,
    //             )
    //             return response.data
    //         }

    //         const data = await fetchAllTraces()
    //         setTraces(
    //             data.trees.flatMap((item: AgentaRootsResponse) =>
    //                 // @ts-ignore
    //                 observabilityTransformer(item),
    //             ) as _AgentaRootsResponse[],
    //         )
    //     } catch (error) {
    //         console.log(error)
    //     }
    // }

    // const onTraceTabChange = async (e: RadioChangeEvent) => {
    //     setTraceTabs(e.target.value)
    //     try {
    //         const tab = e.target.value
    //         if (!tab) return
    //         const query =
    //             tab === "all"
    //                 ? `&focus=tree`
    //                 : `&focus=node&node_type=${tab == "llm" ? "CHAT" : "WORKFLOW"}`

    //         const fetchAllTraces = async () => {
    //             const response = await axios.get(
    //                 `${getAgentaApiUrl()}/api/observability/v1/0192ba30-1a80-7093-8c99-456a914f829d/traces?focus=tree${query}`,
    //             )
    //             return response.data
    //         }

    //         const data = await fetchAllTraces()

    //         // setTraces(data.nodes)
    //     } catch (error) {
    //         console.log(error)
    //     }
    // }

    const lol = "dfdf"

    // synchronization code - version 2
    // -------------------------------------------------------------------------

    // Update search filter based on search input change
    const onSearchQueryApply = () => {
        updateFilter("data", "contains", searchQuery)
    }

    // Update filters based on Radio button change
    const onTraceTabChange = (e: RadioChangeEvent) => {
        const selectedTab = e.target.value
        setTraceTabs(selectedTab)

        if (selectedTab == "all") {
            setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "node.type"))
        } else {
            updateFilter("node.type", "eq", selectedTab)
        }
    }

    const updateFilter = (key: string, operator: FilterConditions, value: string) => {
        setFilters((prevFilters) => {
            const otherFilters = prevFilters.filter((f) => f.key !== key)
            return value ? [...otherFilters, {key, operator, value}] : otherFilters
        })
    }

    const onSearchClear = () => {
        setSearchQuery("") // Clear the search query
        setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "data")) // Remove the filter for 'data'
    }

    // Sync searchQuery with filters state
    useUpdateEffect(() => {
        const dataFilter = filters.find((f) => f.key === "data")
        setSearchQuery(dataFilter ? dataFilter.value : "")
    }, [filters])

    // Sync traceTabs with filters state
    useUpdateEffect(() => {
        const nodeTypeFilter = filters.find((f) => f.key === "node.type")
        setTraceTabs(nodeTypeFilter ? nodeTypeFilter.value : "all")
    }, [filters])

    const onClearFilter = () => {
        setFilters([])
        setSearchQuery("")
        setTraceTabs("all")
    }

    const onApplyFilter = (newFilters: Filter[]) => {
        setFilters(newFilters)
    }

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            {traces?.length ? (
                <section className="flex flex-col gap-2">
                    <div className="flex justify-between gap-2 flex-col 2xl:flex-row 2xl:items-center">
                        <Space>
                            <Input.Search
                                placeholder="Search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onPressEnter={onSearchQueryApply}
                                onSearch={onSearchClear}
                                className="w-[320px]"
                                allowClear
                            />
                            <Filters
                                filterData={filters}
                                columns={filterColumns}
                                onApplyFilter={onApplyFilter}
                                onClearFilter={onClearFilter}
                            />
                            <Sort onSortApply={onSortApply} defaultSortValue="1 month" />
                        </Space>
                        <div className="w-full flex items-center justify-between">
                            <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                                <Radio.Button value="all">All</Radio.Button>
                                <Radio.Button value="llm">LLM</Radio.Button>
                                <Radio.Button value="workflows">Workflows</Radio.Button>
                            </Radio.Group>
                            <Space>
                                <Button
                                    type="text"
                                    onClick={onExport}
                                    icon={<Export size={14} className="mt-0.5" />}
                                    disabled={traces.length === 0}
                                    loading={isExportLoading}
                                >
                                    Export as CSV
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
                    </div>

                    <Table
                        columns={(mergedColumns as TableColumnType<_AgentaRootsResponse>[]).map(
                            (col) => ({
                                ...col,
                                hidden: editColumns.includes(col.key as string),
                            }),
                        )}
                        dataSource={traces}
                        bordered
                        style={{cursor: "pointer"}}
                        onRow={(record) => ({
                            onClick: () => {
                                setSelectedTraceId(record.root.id)
                            },
                        })}
                        components={{
                            header: {
                                cell: ResizableTitle,
                            },
                        }}
                        pagination={false}
                        scroll={{x: "max-content"}}
                    />
                </section>
            ) : null}

            {activeTrace && !!traces?.length && (
                <GenericDrawer
                    open={!!selectedTraceId}
                    onClose={() => setSelectedTraceId("")}
                    expandable
                    headerExtra={
                        <TraceHeader
                            activeTrace={activeTrace}
                            traces={traces}
                            setSelectedTraceId={setSelectedTraceId}
                            activeTraceIndex={activeTraceIndex}
                        />
                    }
                    mainContent={selectedItem ? <TraceContent activeTrace={selectedItem} /> : null}
                    sideContent={
                        <TraceTree
                            activeTrace={activeTrace}
                            selected={selected}
                            setSelected={setSelected}
                        />
                    }
                />
            )}
        </div>
    )
}

export default ObservabilityDashboard
