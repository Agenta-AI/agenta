import {dynamicComponent} from "@/lib/helpers/dynamic"
import EmptyComponent from "@/components/EmptyComponent"
import GenericDrawer from "@/components/GenericDrawer"
import {nodeTypeStyles} from "./components/AvatarTreeContent"
import StatusRenderer from "./components/StatusRenderer"
import TraceContent from "./drawer/TraceContent"
import TraceHeader from "./drawer/TraceHeader"
import TraceTree from "./drawer/TraceTree"
import Filters from "@/components/Filters/Filters"
import Sort, {SortResult} from "@/components/Filters/Sort"
import EditColumns from "@/components/Filters/EditColumns"
import ResultTag from "@/components/ResultTag/ResultTag"
import {ResizableTitle} from "@/components/ServerTable/components"
import {useAppId} from "@/hooks/useAppId"
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {getNodeById} from "@/lib/helpers/observability_helpers"
import {Filter, FilterConditions, JSSTheme, KeyValuePair} from "@/lib/Types"
import {_AgentaRootsResponse} from "@/services/observability/types"
import {ReloadOutlined, SwapOutlined} from "@ant-design/icons"
import {
    Button,
    Input,
    Pagination,
    Radio,
    RadioChangeEvent,
    Space,
    Table,
    TableColumnType,
    Tag,
    Tooltip,
    Typography,
} from "antd"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import {useRouter} from "next/router"
import React, {useCallback, useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import {Database, Export} from "@phosphor-icons/react"
import {getAppValues} from "@/contexts/app.context"
import {convertToCsv, downloadCsv} from "@/lib/helpers/fileManipulations"
import useLazyEffect from "@/hooks/useLazyEffect"
import {getStringOrJson} from "@/lib/helpers/utils"
import ObservabilityContextProvider, {useObservabilityData} from "@/contexts/observability.context"
import {TestsetTraceData, TestsetDrawerProps} from "./drawer/TestsetDrawer/assets/types"
const TestsetDrawer = dynamicComponent<TestsetDrawerProps>(
    "pages/observability/drawer/TestsetDrawer/TestsetDrawer",
)

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
    pagination: {
        "& > .ant-pagination-options": {
            order: -1,
            marginRight: 8,
        },
    },
}))

const ObservabilityDashboard = () => {
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
    const appId = useAppId()
    const router = useRouter()
    const classes = useStyles()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")
    const [editColumns, setEditColumns] = useState<string[]>(["span_type", "key", "usage"])
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [testsetDrawerData, setTestsetDrawerData] = useState<TestsetTraceData[]>([])
    const [columns, setColumns] = useState<ColumnsType<_AgentaRootsResponse>>([
        {
            title: "ID",
            dataIndex: ["node", "id"],
            key: "key",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            fixed: "left",
            render: (_, record) => {
                return <ResultTag value1={`# ${record.node.id.split("-")[0]}`} />
            },
        },
        {
            title: "Name",
            dataIndex: ["node", "name"],
            key: "name",
            ellipsis: true,
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            fixed: "left",
            render: (_, record) => {
                const {icon: Icon} = nodeTypeStyles[record.node.type ?? "default"]

                return (
                    <Space align="center" size={4}>
                        <div className="grid place-items-center">
                            <Icon size={16} />
                        </div>
                        <Typography>
                            {record.node.name.length >= 15 ? (
                                <Tooltip title={record.node.name} placement="bottom">
                                    {record.node.name.slice(0, 15)}...
                                </Tooltip>
                            ) : (
                                record.node.name
                            )}
                        </Typography>
                    </Space>
                )
            },
        },
        {
            title: "Span type",
            key: "span_type",
            dataIndex: ["node", "type"],
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return <div>{record.node.type}</div>
            },
        },
        {
            title: "Inputs",
            key: "inputs",
            width: 400,
            render: (_, record) => {
                return (
                    <Tooltip
                        title={getStringOrJson(record?.data?.inputs)}
                        overlayInnerStyle={{width: 400}}
                        className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]"
                        placement="bottom"
                    >
                        <Tag>{getStringOrJson(record?.data?.inputs)}</Tag>
                    </Tooltip>
                )
            },
        },
        {
            title: "Outputs",
            key: "outputs",
            width: 400,
            render: (_, record) => {
                return (
                    <Tooltip
                        title={getStringOrJson(record?.data?.outputs)}
                        overlayInnerStyle={{width: 400}}
                        className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]"
                        placement="bottom"
                    >
                        <Tag>{getStringOrJson(record?.data?.outputs)}</Tag>
                    </Tooltip>
                )
            },
        },
        {
            title: "Duration",
            key: "duration",
            dataIndex: ["time", "span"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => (
                <div>
                    {formatLatency(
                        record?.metrics?.acc?.duration?.total
                            ? record?.metrics?.acc?.duration?.total / 1000
                            : null,
                    )}
                </div>
            ),
        },
        {
            title: "Cost",
            key: "cost",
            dataIndex: ["metrics", "acc", "costs", "total"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => <div>{formatCurrency(record.metrics?.acc?.costs?.total)}</div>,
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
            title: "Timestamp",
            key: "timestamp",
            dataIndex: ["lifecycle", "created_at"],
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return (
                    <div>
                        {dayjs(record.lifecycle?.created_at).local().format("HH:mm:ss DD MMM YYYY")}
                    </div>
                )
            },
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
    ])
    const activeTraceIndex = useMemo(
        () =>
            traces?.findIndex((item) =>
                traceTabs === "node"
                    ? item.node.id === selectedTraceId
                    : item.root.id === selectedTraceId,
            ),
        [selectedTraceId, traces, traceTabs],
    )

    const activeTrace = useMemo(() => traces[activeTraceIndex] ?? null, [activeTraceIndex, traces])

    const [selected, setSelected] = useState("")

    useEffect(() => {
        if (!selected) {
            setSelected(activeTrace?.node.id)
        }
    }, [activeTrace, selected])

    useEffect(() => {
        const interval = setInterval(fetchTraces, 300000)

        return () => clearInterval(interval)
    }, [])

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const selectedItem = useMemo(
        () => (traces?.length ? getNodeById(traces, selected) : null),
        [selected, traces],
    )

    const handleNextTrace = useCallback(() => {
        if (activeTraceIndex !== undefined && activeTraceIndex < traces.length - 1) {
            const nextTrace = traces[activeTraceIndex + 1]
            if (traceTabs === "node") {
                setSelectedTraceId(nextTrace.node.id)
            } else {
                setSelectedTraceId(nextTrace.root.id)
            }
            setSelected(nextTrace.node.id)
        }
    }, [activeTraceIndex, traces, traceTabs, setSelectedTraceId])

    const handlePrevTrace = useCallback(() => {
        if (activeTraceIndex !== undefined && activeTraceIndex > 0) {
            const prevTrace = traces[activeTraceIndex - 1]
            if (traceTabs === "node") {
                setSelectedTraceId(prevTrace.node.id)
            } else {
                setSelectedTraceId(prevTrace.root.id)
            }
            setSelected(prevTrace.node.id)
        }
    }, [activeTraceIndex, traces, traceTabs, setSelectedTraceId])

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
            hidden: editColumns.includes(col.key as string),
            onHeaderCell: (column: TableColumnType<_AgentaRootsResponse>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
        }))
    }, [columns, editColumns])

    const filterColumns = [
        {type: "exists", value: "tree.id", label: "tree ID"},
        {type: "exists", value: "node.id", label: "node ID"},
        {type: "exists", value: "node.type", label: "node type"},
        {type: "exists", value: "node.name", label: "node name"},
        {type: "exists", value: "status.code", label: "status code"},
        {type: "exists", value: "status.message", label: "status message"},
        {type: "exists", value: "exception.type", label: "exception type"},
        {type: "exists", value: "exception.message", label: "exception message"},
        {type: "exists", value: "exception.stacktrace", label: "exception stacktrace"},
        {type: "string", value: "content", label: "content"},
        {type: "number", value: "metrics.acc.duration.total", label: "duration"},
        {type: "number", value: "metrics.acc.costs.total", label: "cost"},
        {type: "number", value: "metrics.acc.tokens.prompt", label: "prompt tokens (accumulated)"},
        {
            type: "number",
            value: "metrics.acc.tokens.completion",
            label: "completion tokens (accumulated)",
        },
        {type: "number", value: "metrics.acc.tokens.total", label: "usage"},
        {type: "number", value: "metrics.unit.tokens.prompt", label: "prompt tokens"},
        {type: "number", value: "metrics.unit.tokens.completion", label: "completion tokens"},
        {type: "exists", value: "refs.variant.id", label: "variant ID"},
        {type: "exists", value: "refs.variant.slug", label: "variant slug"},
        {type: "exists", value: "refs.variant.version", label: "variant version"},
        {type: "exists", value: "refs.environment.id", label: "environment ID"},
        {type: "exists", value: "refs.environment.slug", label: "environment slug"},
        {type: "exists", value: "refs.environment.version", label: "environment version"},
        {type: "exists", value: "refs.application.id", label: "application ID"},
        {type: "exists", value: "refs.application.slug", label: "application slug"},
    ]

    const onExport = async () => {
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
                    Timestamp: dayjs(trace.time.start).local().format("HH:mm:ss DD MMM YYYY"),
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
    }

    const handleToggleColumnVisibility = useCallback((key: string) => {
        setEditColumns((prev) =>
            prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
        )
    }, [])

    const updateFilter = ({
        key,
        operator,
        value,
    }: {
        key: string
        operator: FilterConditions
        value: string
    }) => {
        setFilters((prevFilters) => {
            const otherFilters = prevFilters.filter((f) => f.key !== key)
            return value ? [...otherFilters, {key, operator, value}] : otherFilters
        })
    }

    const onPaginationChange = (current: number, pageSize: number) => {
        setPagination({size: pageSize, page: current})
    }
    // reset pagination to page 1 whenever quearies get updated
    useLazyEffect(() => {
        if (pagination.page > 1) {
            setPagination({...pagination, page: 1})
        }
    }, [filters, sort, traceTabs])

    const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value
        setSearchQuery(query)

        if (!query) {
            setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "content"))
        }
    }

    const onSearchQueryApply = () => {
        if (searchQuery) {
            updateFilter({key: "content", operator: "contains", value: searchQuery})
        }
    }

    const onSearchClear = () => {
        const isSearchFilterExist = filters.some((item) => item.key === "content")

        if (isSearchFilterExist) {
            setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "content"))
        }
    }
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

    const onTraceTabChange = async (e: RadioChangeEvent) => {
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
    }
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

    const getTestsetTraceData = () => {
        if (!traces?.length) return []

        const extractData = selectedRowKeys.map((key, idx) => {
            const node = getNodeById(traces, key as string)
            return {data: node?.data as KeyValuePair, key: node?.key, id: idx + 1}
        })

        if (extractData.length > 0) {
            setTestsetDrawerData(extractData as TestsetTraceData[])
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            <div className="flex justify-between gap-2 flex-col 2xl:flex-row 2xl:items-center">
                <Space>
                    <Button
                        icon={<ReloadOutlined />}
                        onClick={() => {
                            fetchTraces()
                        }}
                    >
                        Reload
                    </Button>
                    <Input.Search
                        placeholder="Search"
                        value={searchQuery}
                        onChange={onSearchChange}
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
                            Add test set
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

            <div className="flex flex-col gap-2">
                <Table
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        selectedRowKeys,
                        ...rowSelection,
                    }}
                    loading={isLoading}
                    columns={mergedColumns as TableColumnType<_AgentaRootsResponse>[]}
                    dataSource={traces}
                    bordered
                    style={{cursor: "pointer"}}
                    onRow={(record) => ({
                        onClick: () => {
                            setSelected(record.node.id)
                            if (traceTabs === "node") {
                                setSelectedTraceId(record.node.id)
                            } else {
                                setSelectedTraceId(record.root.id)
                            }
                        },
                    })}
                    components={{
                        header: {
                            cell: ResizableTitle,
                        },
                    }}
                    pagination={false}
                    scroll={{x: "max-content"}}
                    locale={{
                        emptyText: (
                            <div className="py-16">
                                <EmptyComponent
                                    image={
                                        <SwapOutlined
                                            style={{transform: "rotate(90deg)"}}
                                            className="text-[32px]"
                                        />
                                    }
                                    description="Monitor the performance and results of your LLM applications here."
                                    primaryCta={{
                                        text: appId ? "Go to Playground" : "Create an Application",
                                        onClick: () =>
                                            router.push(
                                                appId ? `/apps/${appId}/playground` : "/apps",
                                            ),
                                        tooltip:
                                            "Run your LLM app in the playground to generate and view insights.",
                                    }}
                                    secondaryCta={{
                                        text: "Learn More",
                                        onClick: () =>
                                            router.push(
                                                "https://docs.agenta.ai/observability/quickstart",
                                            ),
                                        tooltip:
                                            "Explore more about tracking and analyzing your app's observability data.",
                                    }}
                                />
                            </div>
                        ),
                    }}
                />
                <Pagination
                    total={count}
                    align="end"
                    className={classes.pagination}
                    current={pagination.page}
                    pageSize={pagination.size}
                    onChange={onPaginationChange}
                />
            </div>

            <TestsetDrawer
                open={testsetDrawerData.length > 0}
                data={testsetDrawerData}
                onClose={() => {
                    setTestsetDrawerData([])
                    setSelectedRowKeys([])
                }}
            />

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
                            handleNextTrace={handleNextTrace}
                            handlePrevTrace={handlePrevTrace}
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

export default () => (
    <ObservabilityContextProvider>
        <ObservabilityDashboard />
    </ObservabilityContextProvider>
)
