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
import {Filter, JSSTheme, SortTypes} from "@/lib/Types"
import {_AgentaRootsResponse} from "@/services/observability/types"
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
    const [traceTabs, setTraceTabs] = useState("root calls")
    const [editColumns, setEditColumns] = useState<string[]>([])
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
        {column: "inputs", mapping: "data.inputs.topic"},
        {column: "outputs", mapping: "data.outputs"},
        {column: "status", mapping: "status.code"},
        {column: "costs", mapping: "metrics.acc.costs.total"},
        {column: "tokens", mapping: "metrics.acc.tokens.total"},
        {column: "node_name", mapping: "node.name"},
        {column: "node_type", mapping: "node.type"},
    ]

    const onFilterApply = (filter: Filter[]) => {}

    const onClearFilter = async (filter: Filter[]) => {}

    const onSortApply = (sortData: SortTypes) => {}

    const onSearchQueryAppy = async () => {}

    const handleToggleColumnVisibility = (key: string) => {
        setEditColumns((prev) =>
            prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
        )
    }

    const onTraceTabChange = (e: RadioChangeEvent) => {
        setTraceTabs(e.target.value)
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
                                onPressEnter={onSearchQueryAppy}
                                className="w-[320px]"
                                allowClear
                            />
                            <Filters
                                columns={filterColumns}
                                onApplyFilter={onFilterApply}
                                onClearFilter={onClearFilter}
                            />
                            <Sort onSortApply={onSortApply} defaultSortValue="1 month" />
                        </Space>
                        <div className="w-full flex items-center justify-between">
                            <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                                <Radio.Button value="root calls">Root calls</Radio.Button>
                                <Radio.Button value="generations">Generation</Radio.Button>
                                <Radio.Button value="all runs">All runs</Radio.Button>
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
