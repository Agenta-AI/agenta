import {Dispatch, SetStateAction, useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, SidebarSimple} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"

import DeleteTraceModal from "../components/DeleteTraceModal"
import {TracesWithAnnotations} from "../ObservabilityDashboard"

interface TraceHeaderProps {
    activeTrace: TracesWithAnnotations
    traces: _AgentaRootsResponse[]
    setSelectedTraceId: (val: string) => void
    activeTraceIndex?: number
    handleNextTrace?: () => void
    handlePrevTrace?: () => void
    setIsAnnotationsSectionOpen: Dispatch<SetStateAction<boolean>>
    isAnnotationsSectionOpen: boolean
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
    setIsAnnotationsSectionOpen,
    isAnnotationsSectionOpen,
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

                <Space>
                    <Button icon={<DeleteOutlined />} onClick={() => setIsDeleteModalOpen(true)} />
                    <Button
                        icon={<SidebarSimple size={14} />}
                        type={isAnnotationsSectionOpen ? "default" : "primary"}
                        className="shrink-0 flex items-center justify-center"
                        onClick={() => setIsAnnotationsSectionOpen((prev) => !prev)}
                    />
                </Space>
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
