import EmptyComponent from "@/components/EmptyComponent"
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
import {useAppId} from "@/hooks/useAppId"
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {
    buildNodeTree,
    getNodeById,
    observabilityTransformer,
} from "@/lib/helpers/observability_helpers"
import {useTraces} from "@/lib/hooks/useTraces"
import {Filter, FilterConditions, JSSTheme, SortTypes} from "@/lib/Types"
import {_AgentaRootsResponse, AgentaNodeDTO, AgentaTreeDTO} from "@/services/observability/types"
import {SwapOutlined} from "@ant-design/icons"
import {
    Button,
    Input,
    Radio,
    RadioChangeEvent,
    Space,
    Table,
    TableColumnType,
    Tag,
    Typography,
} from "antd"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import {useRouter} from "next/router"
import React, {useCallback, useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import {Export} from "@phosphor-icons/react"
import {getAppValues} from "@/contexts/app.context"
import {convertToCsv, downloadCsv} from "@/lib/helpers/fileManipulations"
import {useUpdateEffect} from "usehooks-ts"
import {getAgentaApiUrl, getStringOrJson} from "@/lib/helpers/utils"
import axios from "axios"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

interface Props {}

type TraceTabTypes = "tree" | "node" | "chat"

const ObservabilityDashboard = ({}: Props) => {
    const appId = useAppId()
    const router = useRouter()
    const classes = useStyles()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")
    const {traces, isLoadingTraces, setIsLoadingTraces, setTraces} = useTraces()
    const [searchQuery, setSearchQuery] = useState("")
    const [traceTabs, setTraceTabs] = useState<TraceTabTypes>("tree")
    const [editColumns, setEditColumns] = useState<string[]>(["span_type"])
    const [filters, setFilters] = useState<Filter[]>([])
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
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
            render: (_, record) => {
                return (
                    <Tag
                        title={getStringOrJson(record?.data?.inputs)}
                        className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]"
                    >
                        {getStringOrJson(record?.data?.inputs)}
                    </Tag>
                )
            },
        },
        {
            title: "Outputs",
            key: "outputs",
            width: 350,
            render: (_, record) => {
                return (
                    <Tag
                        title={getStringOrJson(record?.data?.outputs)}
                        className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]"
                    >
                        {getStringOrJson(record?.data?.outputs)}
                    </Tag>
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
        {
            title: "Latency",
            key: "latency",
            dataIndex: ["time", "span"],
            width: 80,
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => <div>{formatLatency(record?.metrics?.acc?.duration.total)}</div>,
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

    const [selected, setSelected] = useState("")

    useEffect(() => {
        if (!selected) {
            setSelected(activeTrace?.node.id)
        }
    }, [activeTrace, selected])

    const selectedItem = useMemo(
        () => (traces?.length ? getNodeById(traces, selected) : null),
        [selected, traces],
    )

    const handleNextTrace = useCallback(() => {
        if (activeTraceIndex !== undefined && activeTraceIndex < traces.length - 1) {
            const nextTrace = traces[activeTraceIndex + 1]
            setSelectedTraceId(nextTrace.root.id)
            setSelected(nextTrace.node.id)
        }
    }, [activeTraceIndex, traces, setSelectedTraceId])

    const handlePrevTrace = useCallback(() => {
        if (activeTraceIndex !== undefined && activeTraceIndex > 0) {
            const prevTrace = traces[activeTraceIndex - 1]
            setSelectedTraceId(prevTrace.root.id)
            setSelected(prevTrace.node.id)
        }
    }, [activeTraceIndex, traces, setSelectedTraceId])

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

    const onExport = async () => {
        try {
            if (traces.length) {
                const {currentApp} = getAppValues()
                const filename = `${currentApp?.app_name}_observability.csv`

                const convertToStringOrJson = (value: any) => {
                    return typeof value === "string" ? value : JSON.stringify(value)
                }

                // Helper function to create a trace object
                const createTraceObject = (trace: any) => ({
                    "Trace ID": trace.key,
                    Timestamp: dayjs(trace.time.start).format("HH:mm:ss DD MMM YYYY"),
                    Inputs: trace?.data?.inputs?.topic || "N/A",
                    Outputs: convertToStringOrJson(trace?.data?.outputs) || "N/A",
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
        }
    }

    const filterColumns = [
        {value: "root.id", label: "root.id"},
        {value: "tree.id", label: "tree.id"},
        {value: "tree.type", label: "tree.type"},
        {value: "node.id", label: "node.id"},
        {value: "node.type", label: "node.type"},
        {value: "node.name", label: "node.name"},
        {value: "parent.id", label: "parent.id"},
        {value: "status.code", label: "status.code"},
        {value: "status.message", label: "status.message"},
        {value: "exception.timestamp", label: "exception.timestamp"},
        {value: "exception.type", label: "exception.type"},
        {value: "exception.message", label: "exception.message"},
        {value: "exception.stacktrace", label: "exception.stacktrace"},
        {value: "data", label: "data"},
        {value: "metrics.acc.duration.total", label: "metrics.acc.duration.total"},
        {value: "metrics.acc.cost.total", label: "metrics.acc.cost.total"},
        {value: "metrics.unit.cost.total", label: "metrics.unit.cost.total"},
        {value: "metrics.acc.tokens.prompt", label: "metrics.acc.tokens.prompt"},
        {value: "metrics.acc.tokens.completion", label: "metrics.acc.tokens.completion"},
        {value: "metrics.acc.tokens.total", label: "metrics.acc.tokens.total"},
        {value: "metrics.unit.tokens.prompt", label: "metrics.unit.tokens.prompt"},
        {value: "metrics.unit.tokens.completion", label: "metrics.unit.tokens.completion"},
        {value: "metrics.unit.tokens.total", label: "metrics.unit.tokens.total"},
        {value: "refs.variant.id", label: "refs.variant.id"},
        {value: "refs.variant.slug", label: "refs.variant.slug"},
        {value: "refs.variant.version", label: "refs.variant.version"},
        {value: "refs.environment.id", label: "refs.environment.id"},
        {value: "refs.environment.slug", label: "refs.environment.slug"},
        {value: "refs.environment.version", label: "refs.environment.version"},
        {value: "refs.application.id", label: "refs.application.id"},
        {value: "refs.application.slug", label: "refs.application.slug"},
        {value: "link.type", label: "link.type"},
        {value: "link.node.id", label: "link.node.id"},
        {value: "otel.kind", label: "otel.kind"},
    ]

    const onSortApply = async ({
        sortData,
        customSortData,
    }: {
        sortData: SortTypes
        customSortData?: any
    }) => {
        let time
        let query: string
        if (sortData !== "custom" && sortData && sortData !== "all time") {
            const now = dayjs().utc() // Get the current UTC time

            // Split the value into number and unit (e.g., "30 minutes" becomes ["30", "minutes"])
            const [amount, unit] = sortData.split(" ")
            time = now
                .subtract(parseInt(amount), unit as dayjs.ManipulateType)
                .toISOString()
                .split(".")[0]
            query = `&earliest=${time}`
        } else if (customSortData?.startTime && sortData == "custom") {
            query = `earliest=${customSortData.startTime.toISOString().split(".")[0]}&latest=${customSortData.endTime.toISOString().split(".")[0]}`
        } else if (sortData === "all time") {
            time = "1970-01-01T00:00:00"
            query = `&earliest=${time}`
        }

        try {
            const fetchAllTraces = async () => {
                const response = await axios.get(
                    `${getAgentaApiUrl()}/api/observability/v1/traces/search?project_id=0192c229-3760-759d-a637-959921135050&${query}`,
                )
                return response.data
            }

            const data = await fetchAllTraces()

            setTraces(data.trees.flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)))
        } catch (error) {
            console.log(error)
        }
    }

    const handleToggleColumnVisibility = (key: string) => {
        setEditColumns((prev) =>
            prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
        )
    }

    // ------------------ search filter ------------------
    const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value)

        // if the data filter is exist in filter then remove it when the input value get empty
        if (!e.target.value) {
            const isSearchFilterExist = filters.some((item) => item.key === "data")

            if (isSearchFilterExist) {
                setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "data"))
            }
        }
    }

    const onSearchQueryApply = () => {
        if (searchQuery) {
            updateFilter({key: "data", operator: "contains", value: searchQuery})
        }
    }

    const onSearchClear = () => {
        const isSearchFilterExist = filters.some((item) => item.key === "data")

        if (isSearchFilterExist) {
            setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "data"))
        }
    }

    // Sync searchQuery with filters state
    useUpdateEffect(() => {
        const dataFilter = filters.find((f) => f.key === "data")
        setSearchQuery(dataFilter ? dataFilter.value : "")
    }, [filters])

    // -------------------- group buttons filter ---------------------
    const onTraceTabChange = async (e: RadioChangeEvent) => {
        const selectedTab = e.target.value
        setTraceTabs(selectedTab)

        if (selectedTab === "chat") {
            updateFilter({key: "node.type", operator: "eq", value: selectedTab})
        } else {
            const isNodeTypeFilterExist = filters.some((item) => item.key === "node.type")

            if (isNodeTypeFilterExist) {
                setFilters((prevFilters) => prevFilters.filter((f) => f.key !== "node.type"))
            }
        }
    }

    // Sync traceTabs with filters state
    useUpdateEffect(() => {
        const nodeTypeFilter = filters.find((f) => f.key === "node.type")
        setTraceTabs(nodeTypeFilter?.value ? (nodeTypeFilter.value as TraceTabTypes) : "tree")
    }, [filters])

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

    useUpdateEffect(() => {
        const filterTraceData = async () => {
            try {
                setIsLoadingTraces(true)

                let data
                const focusPoint = traceTabs !== "chat" ? `focus=${traceTabs}` : ""

                const fetchAllFilteredTraces = async () => {
                    const response = await axios.get(
                        `${getAgentaApiUrl()}/api/observability/v1/traces/search?project_id=0192c229-3760-759d-a637-959921135050&${focusPoint}&filtering={"conditions":${JSON.stringify(filters)}}`,
                    )
                    return response.data
                }
                const fetchAllTraces = async () => {
                    const response = await axios.get(
                        `${getAgentaApiUrl()}/api/observability/v1/traces/search?project_id=0192c229-3760-759d-a637-959921135050&${focusPoint}`,
                    )
                    return response.data
                }

                if (filters.length > 0 && filters[0].value) {
                    data = await fetchAllFilteredTraces()
                } else {
                    data = await fetchAllTraces()
                }

                const transformedTraces: _AgentaRootsResponse[] = []

                if (data?.trees) {
                    transformedTraces.push(
                        ...data.trees.flatMap((item: AgentaTreeDTO) =>
                            observabilityTransformer(item),
                        ),
                    )
                }

                if (data?.nodes) {
                    transformedTraces.push(
                        ...data.nodes
                            .flatMap((node: AgentaNodeDTO) => buildNodeTree(node))
                            .flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)),
                    )
                }

                setTraces(transformedTraces)
            } catch (error) {
                console.log(error)
            } finally {
                setIsLoadingTraces(false)
            }
        }
        filterTraceData()
    }, [filters, traceTabs])

    const onApplyFilter = async (newFilters: Filter[]) => {
        setFilters(newFilters)
    }

    const onClearFilter = async () => {
        setFilters([])
        setSearchQuery("")
        if (traceTabs === "chat") {
            setTraceTabs("tree")
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            <div className="flex justify-between gap-2 flex-col 2xl:flex-row 2xl:items-center">
                <Space>
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
                loading={isLoadingTraces}
                columns={mergedColumns as TableColumnType<_AgentaRootsResponse>[]}
                dataSource={traces}
                bordered
                style={{cursor: "pointer"}}
                onRow={(record) => ({
                    onClick: () => {
                        setSelected(record.node.id)
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
                                    text: "Go to Playground",
                                    onClick: () => router.push(`/apps/${appId}/playground`),
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

export default ObservabilityDashboard
