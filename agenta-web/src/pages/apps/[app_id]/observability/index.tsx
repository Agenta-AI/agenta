import GenericDrawer from "@/components/GenericDrawer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import {useQueryParam} from "@/hooks/useQuery"
import {findTraceNodeById} from "@/lib/helpers/observability"
import {useTraces} from "@/lib/hooks/useTraces"
import {JSSTheme} from "@/lib/Types"
import {AgentaNodeDTO, AgentaRootsDTO} from "@/services/observability/types"
import {Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
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

    const activeTrace = useMemo(
        () => traces?.find((item) => item.root.id === selectedTraceId) ?? null,
        [selectedTraceId, traces],
    )

    const defaultSelectedTraceKey = useMemo(() => {
        if (!activeTrace || !activeTrace.trees.length) return undefined
        const firstNodeKey = Object.keys(activeTrace.trees[0].nodes)[0]
        return activeTrace.trees[0].nodes[firstNodeKey].node.id
    }, [activeTrace])

    const [selectedKeys, setSelectedKeys] = useState<string[]>([])
    const [selectedItem, setSelectedItem] = useState<AgentaNodeDTO | null>(null)

    const onSelect = useCallback(
        (keys: React.Key[]) => {
            const selectedId = keys[0] as string
            setSelectedKeys([selectedId])
            const foundItem = findTraceNodeById(activeTrace?.trees[0].nodes, selectedId)
            setSelectedItem(foundItem)
        },
        [activeTrace],
    )

    const columns: ColumnsType<AgentaRootsDTO> = [
        {
            title: "Trace Id",
            dataIndex: "key",
            key: "key",
            width: 200,
            render: (_, record) => {
                return <div>{record.root.id}</div>
            },
        },
    ]

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            <div>Observability Table</div>
            {traces && (
                <Table
                    columns={columns}
                    dataSource={traces}
                    bordered
                    style={{cursor: "pointer"}}
                    onRow={(record) => ({
                        onClick: () => {
                            setSelectedTraceId(record.root.id)
                        },
                    })}
                />
            )}

            {activeTrace && traces?.length && (
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
            )}
        </div>
    )
}

export default ObservabilityDashboard
