import {memo} from "react"

import type {SpanCategory} from "@agenta/entities/trace"
import {Typography} from "antd"

import {spanTypeStyles} from "../assets/constants"

interface Props {
    name?: string | null
    type?: SpanCategory | null
}

const NodeNameCell = memo(({name, type}: Props) => {
    const {icon: Icon} = spanTypeStyles[type ?? "unknown"] ?? spanTypeStyles.unknown

    return (
        <div className="flex items-center gap-1 min-w-0">
            <div className="grid place-items-center shrink-0">
                <Icon size={16} />
            </div>
            <Typography.Text ellipsis={{tooltip: name}} className="flex-1 min-w-0">
                {name}
            </Typography.Text>
        </div>
    )
})

export default NodeNameCell
