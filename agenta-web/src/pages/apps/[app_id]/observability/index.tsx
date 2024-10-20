import GenericDrawer from "@/components/GenericDrawer"
import StatusRenderer from "@/components/pages/observability/components/StatusRenderer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import Filters from "@/components/Filters/Filters"
import Sort from "@/components/Filters/Sort"
import ResultTag from "@/components/ResultTag/ResultTag"
import {useQueryParam} from "@/hooks/useQuery"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/lib/helpers/formatters"
import {getNodeById} from "@/lib/helpers/observability_helpers"
import {useTraces} from "@/lib/hooks/useTraces"
import {Filter, JSSTheme} from "@/lib/Types"
import {_AgentaRootsResponse} from "@/services/observability/types"
import {Radio, RadioChangeEvent, Space, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import {getNestedProperties, getTimeRangeUnit, matcheFilterCriteria} from "@/lib/helpers/utils"

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
    const [searchTerm, setSearchTerm] = useState("")
    const [filterTrace, setFilterTrace] = useState<Filter[]>([] as Filter[])
    const [sortTrace, setSortTrace] = useState("14 days")
    const [traceTabs, setTraceTabs] = useState("root calls")
    const {traces} = useTraces()

    const filterColumns = [
        {column: "inputs", mapping: "data.inputs.topic"},
        {column: "outputs", mapping: "data.outputs"},
        {column: "status", mapping: "status.code"},
        {column: "costs", mapping: "metrics.acc.costs.total"},
        {column: "tokens", mapping: "metrics.acc.tokens.total"},
        {column: "node_name", mapping: "node.name"},
        {column: "node_type", mapping: "node.type"},
    ]

    const activeTraceIndex = useMemo(
        () => traces?.findIndex((item) => item.root.id === selectedTraceId),
        [selectedTraceId, traces],
    )

    const activeTrace = useMemo(() => traces[activeTraceIndex] ?? null, [activeTraceIndex, traces])

    const [selected, setSelected] = useState(activeTrace?.key)

    const [selectedItem, setSelectedItem] = useState<_AgentaRootsResponse | null>(
        getNodeById(traces, selected),
    )

    useEffect(() => {
        setSelected(activeTrace?.key)
    }, [activeTrace])

    const handleTreeNodeClick = (nodeId: string) => {
        const selectedNode = activeTrace ? getNodeById(activeTrace, nodeId) : null
        if (selectedNode) {
            setSelectedItem(selectedNode)
        }
    }

    const onTraceTabChange = (e: RadioChangeEvent) => {
        setTraceTabs(e.target.value)
    }

    const filteredTrace = useMemo(() => {
        let filtered = traces

        if (filterTrace[0]?.keyword) {
            filterTrace.map((item) => {
                const {column, condition, keyword} = item
                filtered = filtered?.filter((trace) => {
                    const propertyValue = getNestedProperties(trace, column)
                    return matcheFilterCriteria({data: propertyValue, condition, keyword})
                })
            })
        }

        if (sortTrace) {
            const now = dayjs()
            const {duration, unit} = getTimeRangeUnit(sortTrace)

            if (duration === Infinity) {
                return filtered
            }

            filtered = filtered?.filter((item) => {
                const itemDate = dayjs(item.lifecycle.created_at)
                return itemDate.isAfter(now.subtract(duration, unit))
            })
        }
    }, [traces, sortTrace, filterTrace])

    const columns: ColumnsType<_AgentaRootsResponse> = [
        {
            title: "ID",
            dataIndex: ["key"],
            key: "key",
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            fixed: "left",
            render: (_, record) => {
                return <ResultTag value1={`# ${record.key.split("-")[0]}`} />
            },
        },
        {
            title: "Timestamp",
            key: "timestamp",
            dataIndex: ["time", "start"],
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
            onHeaderCell: () => ({
                style: {minWidth: 350},
            }),
        },
        {
            title: "Outputs",
            key: "outputs",
            onHeaderCell: () => ({
                style: {minWidth: 350},
            }),
        },
        {
            title: "Status",
            key: "status",
            dataIndex: ["status", "code"],
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => StatusRenderer(record.status),
        },
        {
            title: "Latency",
            key: "latency",
            dataIndex: ["time", "span"],
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => <div>{formatLatency(record.time.span / 1000000)}</div>,
        },
        {
            title: "Usage",
            key: "usage",
            dataIndex: ["metrics", "acc", "tokens", "total"],
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
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
            render: (_, record) => <div>{formatCurrency(record.metrics?.acc?.costs?.total)}</div>,
        },
    ]

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            {traces?.length ? (
                <section className="flex flex-col gap-2">
                    <Space>
                        <Filters
                            filterValue={filterTrace}
                            setFilterValue={setFilterTrace}
                            columns={filterColumns}
                        />
                        <Sort setSort={setSortTrace} sort={sortTrace} />

                        <Radio.Group value={traceTabs} onChange={onTraceTabChange}>
                            <Radio.Button value="root calls">Root calls</Radio.Button>
                            <Radio.Button value="generations">Generation</Radio.Button>
                            <Radio.Button value="all runs">All runs</Radio.Button>
                        </Radio.Group>
                    </Space>
                    <Table
                        columns={columns}
                        dataSource={filteredTrace}
                        bordered
                        style={{cursor: "pointer"}}
                        onRow={(record) => ({
                            onClick: () => {
                                setSelectedTraceId(record.root.id)
                            },
                        })}
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
                            setSelected={(nodeId) => {
                                setSelected(nodeId)
                                handleTreeNodeClick(nodeId.toString())
                            }}
                        />
                    }
                />
            )}
        </div>
    )
}

export default ObservabilityDashboard
