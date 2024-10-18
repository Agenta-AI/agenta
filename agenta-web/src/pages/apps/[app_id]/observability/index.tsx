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
import {findTraceNodeById} from "@/lib/helpers/observability_helpers"
import {getNestedProperties, getTimeRangeUnit, matcheFilterCriteria} from "@/lib/helpers/utils"
import {useTraces} from "@/lib/hooks/useTraces"
import {Filter, JSSTheme} from "@/lib/Types"
import {observabilityTransformer} from "@/services/observability/core"
import {_AgentaRootsResponse, AgentaNodeDTO} from "@/services/observability/types"
import {Input, Space, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dayjs from "dayjs"
import React, {useCallback, useMemo, useState} from "react"
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
    const [searchTerm, setSearchTerm] = useState("")
    const [filterTrace, setFilterTrace] = useState<Filter>({} as Filter)
    const [sortTrace, setSortTrace] = useState("14 days")
    const {traces} = useTraces()

    const filterColumns = [
        {column: "inputs", mapping: "data.inputs.topic"},
        {column: "outputs", mapping: "data.outputs"},
        {column: "status", mapping: "status.code"},
        {column: "costs", mapping: "metrics.acc.costs.total"},
        {column: "tokens", mapping: "metrics.acc.tokens.total"},
        {column: "node name", mapping: "node.name"},
        {column: "node type", mapping: "node.type"},
    ]

    // const activeTrace = useMemo(
    //     () => traces?.find((item) => item.root.id === selectedTraceId) ?? null,
    //     [selectedTraceId, traces],
    // )

    // const defaultSelectedTraceKey = useMemo(() => {
    //     if (!activeTrace || !activeTrace.trees.length) return undefined
    //     const firstNodeKey = Object.keys(activeTrace.trees[0].nodes)[0]
    //     return activeTrace.trees[0].nodes[firstNodeKey].node.id
    // }, [activeTrace])

    // const [selectedKeys, setSelectedKeys] = useState<string[]>([])
    // const [selectedItem, setSelectedItem] = useState<AgentaNodeDTO | null>(null)

    // const onSelect = useCallback(
    //     (keys: React.Key[]) => {
    //         const selectedId = keys[0] as string
    //         setSelectedKeys([selectedId])
    //         const foundItem = findTraceNodeById(activeTrace?.trees[0].nodes, selectedId)
    //         setSelectedItem(foundItem)
    //     },
    //     [activeTrace],
    // )

    const filteredTrace = useMemo(() => {
        let filtered = traces

        if (filterTrace.keyword) {
            const {column, condition, keyword} = filterTrace

            filtered = filtered?.filter((trace) => {
                const propertyValue = getNestedProperties(trace, column)
                return matcheFilterCriteria({data: propertyValue, condition, keyword})
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

        if (searchTerm) {
            filtered = filtered?.filter((item) =>
                item.data?.outputs.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }

        return filtered
    }, [searchTerm, traces, sortTrace, filterTrace])

    console.log(filteredTrace)

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
            <Space>
                <Input.Search
                    placeholder="Search"
                    className="w-[400px]"
                    allowClear
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Sort setSort={setSortTrace} sort={sortTrace} />
                <Filters setFilterValue={setFilterTrace} columns={filterColumns} />
            </Space>
            {traces?.length ? (
                <Table
                    columns={columns}
                    dataSource={filteredTrace}
                    bordered
                    style={{cursor: "pointer"}}
                    onRow={(record) => ({
                        onClick: () => {
                            setSelectedTraceId(record.key)
                        },
                    })}
                    pagination={false}
                    scroll={{x: "max-content"}}
                />
            ) : null}

            {/* {activeTrace && traces?.length && (
                <GenericDrawer
                    open={!!selectedTraceId}
                    onClose={() => setSelectedTraceId("")}
                    expandable
                    headerExtra={
                        <TraceHeader
                            activeTrace={activeTrace}
                            selectedTraceId={selectedTraceId}
                            traces={traces}
                            setSelectedTraceId={setSelectedTraceId}
                        />
                    }
                    mainContent={selectedItem ? <TraceContent activeTrace={selectedItem} /> : null}
                    sideContent={
                        <TraceTree
                            activeTrace={activeTrace.trees[0].nodes}
                            selectedKeys={selectedKeys}
                            onSelect={onSelect}
                            defaultSelectedTraceKey={defaultSelectedTraceKey}
                        />
                    }
                />
            )} */}
        </div>
    )
}

export default ObservabilityDashboard
