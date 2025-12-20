import {memo} from "react"

import {Space, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import {SpanCategory} from "@/oss/services/tracing/types"
import {nodeDisplayNameAtomFamily} from "@/oss/state/newObservability"

import {spanTypeStyles} from "../assets/constants"

interface Props {
    name: string
    type?: SpanCategory
}

const NodeNameCell = memo(({name, type}: Props) => {
    const display = useAtomValue(nodeDisplayNameAtomFamily(name))
    const {icon: Icon} = spanTypeStyles[type ?? "undefined"]

    return (
        <Space align="center" size={4}>
            <div className="grid place-items-center">
                <Icon size={16} />
            </div>
            <Typography>
                {display.truncated ? (
                    <Tooltip title={display.full} placement="bottom">
                        {display.text}
                    </Tooltip>
                ) : (
                    display.text
                )}
            </Typography>
        </Space>
    )
})

export default NodeNameCell
