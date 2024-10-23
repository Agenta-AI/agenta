import GenericDrawer from "@/components/GenericDrawer"
import {nodeTypeStyles} from "@/components/pages/observability/components/AvatarTreeContent"
import StatusRenderer from "@/components/pages/observability/components/StatusRenderer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import ResultTag from "@/components/ResultTag/ResultTag"
import {ResizableTitle} from "@/components/ServerTable/components"
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {getNodeById} from "@/lib/helpers/observability_helpers"
import {useTraces} from "@/lib/hooks/useTraces"
import {JSSTheme} from "@/lib/Types"
import {_AgentaRootsResponse} from "@/services/observability/types"
import {Space, Table, TableColumnType, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import React, {useEffect, useMemo, useState} from "react"
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
    const classes = useStyles()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")
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
            render: (_, record) => StatusRenderer(record.status),
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

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            {traces?.length ? (
                <Table
                    columns={mergedColumns as TableColumnType<_AgentaRootsResponse>[]}
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
