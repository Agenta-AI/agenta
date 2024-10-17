import GenericDrawer from "@/components/GenericDrawer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import ResultTag from "@/components/ResultTag/ResultTag"
import {useQueryParam} from "@/hooks/useQuery"
import {findTraceNodeById} from "@/lib/helpers/observability_helpers"
import {useTraces} from "@/lib/hooks/useTraces"
import {JSSTheme} from "@/lib/Types"
import {observabilityTransformer} from "@/services/observability/core"
import {AgentaNodeDTO} from "@/services/observability/types"
import {Table, Typography} from "antd"
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
    const {traces} = useTraces()
    console.log(traces)

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

    const columns: ColumnsType<
        Omit<AgentaNodeDTO, "nodes"> & {
            key: string
        }
    > = [
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
        },
        {
            title: "Latency",
            key: "latency",
            dataIndex: ["time", "span"],
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
        },
        {
            title: "Usage",
            key: "usage",
            dataIndex: ["metrics", "acc", "tokens", "total"],
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
        },
        {
            title: "Total cost",
            key: "total_cost",
            dataIndex: ["metrics", "acc", "costs", "total"],
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
        },
    ]

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            {traces?.length ? (
                <Table
                    columns={columns}
                    dataSource={traces}
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
