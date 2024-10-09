import GenericDrawer from "@/components/GenericDrawer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import {useQueryParam} from "@/hooks/useQuery"
import {useTraces} from "@/lib/hooks/useTraces"
import {JSSTheme} from "@/lib/Types"
import {AgentaRootsDTO} from "@/services/observability/types"
import {Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useMemo} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

interface Props {}

const ObservabilityDashboard: React.FC<Props> = () => {
    const classes = useStyles()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")
    const {traces} = useTraces()

    const activeTrace = useMemo(() => {
        return traces?.find((item) => item.root.id === selectedTraceId)
    }, [selectedTraceId, traces])

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
                    mainContent={<TraceContent />}
                    sideContent={<TraceTree />}
                />
            )}
        </div>
    )
}

export default ObservabilityDashboard
