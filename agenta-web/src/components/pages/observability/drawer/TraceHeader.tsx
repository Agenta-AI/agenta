import {JSSTheme} from "@/lib/Types"
import {_AgentaRootsResponse} from "@/services/observability/types"
import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import DeleteTraceModal from "../components/DeleteTraceModal"

interface TraceHeaderProps {
    activeTrace: _AgentaRootsResponse
    traces: _AgentaRootsResponse[]
    setSelectedTraceId: (val: string) => void
    activeTraceIndex?: number
    handleNextTrace?: () => void
    handlePrevTrace?: () => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
}))

const TraceHeader = ({
    activeTrace,
    traces,
    setSelectedTraceId,
    activeTraceIndex,
    handleNextTrace,
    handlePrevTrace,
}: TraceHeaderProps) => {
    const classes = useStyles()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

    return (
        <>
            <div className="flex items-center justify-between">
                <Space>
                    <div>
                        <Button
                            onClick={handlePrevTrace}
                            type="text"
                            disabled={activeTraceIndex === 0}
                            icon={<CaretUp size={16} />}
                        />
                        <Button
                            onClick={handleNextTrace}
                            type="text"
                            disabled={activeTraceIndex === traces.length - 1}
                            icon={<CaretDown size={16} />}
                        />
                    </div>

                    <Typography.Text className={classes.title}>Trace</Typography.Text>
                    <Tag className="font-normal"># {activeTrace.root.id}</Tag>
                </Space>

                <Button icon={<DeleteOutlined />} onClick={() => setIsDeleteModalOpen(true)} />
            </div>

            <DeleteTraceModal
                open={isDeleteModalOpen}
                onCancel={() => setIsDeleteModalOpen(false)}
                activeTraceNodeId={activeTrace.node.id}
                setSelectedTraceId={setSelectedTraceId}
            />
        </>
    )
}

export default TraceHeader
