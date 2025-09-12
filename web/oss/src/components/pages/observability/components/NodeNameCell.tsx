import {memo} from "react"

import {Space, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import {nodeDisplayNameAtomFamily} from "@/oss/state/newObservability"

import {nodeTypeStyles} from "../assets/constants"

interface Props {
    name: string
    type?: string
}

const NodeNameCell = memo(({name, type}: Props) => {
    const display = useAtomValue(nodeDisplayNameAtomFamily(name))
    const {icon: Icon} = nodeTypeStyles[type ?? "default"]

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
