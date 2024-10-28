import EmptyComponent from "@/components/EmptyComponent"
import GenericDrawer from "@/components/GenericDrawer"
import {nodeTypeStyles} from "@/components/pages/observability/components/AvatarTreeContent"
import StatusRenderer from "@/components/pages/observability/components/StatusRenderer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import ResultTag from "@/components/ResultTag/ResultTag"
import {ResizableTitle} from "@/components/ServerTable/components"
import {useAppId} from "@/hooks/useAppId"
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {getNodeById} from "@/lib/helpers/observability_helpers"
import {getStringOrJson} from "@/lib/helpers/utils"
import {useTraces} from "@/lib/hooks/useTraces"
import {JSSTheme} from "@/lib/Types"
import {_AgentaRootsResponse} from "@/services/observability/types"
import {SwapOutlined} from "@ant-design/icons"
import {Space, Table, TableColumnType, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import {useRouter} from "next/router"
import React, {useCallback, useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

interface Props {}

const ObservabilityDashboard = ({}: Props) => {
    const appId = useAppId()
    const router = useRouter()
    const classes = useStyles()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")
    const {traces, isLoadingTraces} = useTraces()
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
            onHeaderCell: (column: TableColumnType<_AgentaRootsResponse>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
        }))
    }, [columns])

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

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
