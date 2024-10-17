import {JSSTheme} from "@/lib/Types"
import {AgentaRootsDTO} from "@/services/observability/types"
import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import React, {useMemo, useCallback} from "react"
import {createUseStyles} from "react-jss"

interface TraceHeaderProps {
    activeTrace: AgentaRootsDTO
    selectedTraceId: string
    traces: AgentaRootsDTO[]
    setSelectedTraceId: (val: string) => void
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
    selectedTraceId,
    traces,
    setSelectedTraceId,
}: TraceHeaderProps) => {
    const classes = useStyles()

    const activeTraceIndex = useMemo(
        () => traces?.findIndex((item) => item.root.id === selectedTraceId),
        [selectedTraceId, traces],
    )

    const handleNextTrace = useCallback(() => {
        if (activeTraceIndex !== undefined && activeTraceIndex < traces.length - 1) {
            setSelectedTraceId(traces[activeTraceIndex + 1].root.id)
        }
    }, [activeTraceIndex, traces, setSelectedTraceId])

    const handlePrevTrace = useCallback(() => {
        if (activeTraceIndex !== undefined && activeTraceIndex > 0) {
            setSelectedTraceId(traces[activeTraceIndex - 1].root.id)
        }
    }, [activeTraceIndex, traces, setSelectedTraceId])

    return (
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

            <Button icon={<DeleteOutlined />} />
        </div>
    )
}

export default TraceHeader
