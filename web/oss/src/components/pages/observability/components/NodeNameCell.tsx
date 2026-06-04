import {memo} from "react"

import {Typography} from "antd"

import {SpanCategory} from "@/oss/services/tracing/types"

import {spanTypeStyles} from "../assets/constants"

interface Props {
    name: string
    type?: SpanCategory
}

const NodeNameCell = memo(({name, type}: Props) => {
    const {icon: Icon} = spanTypeStyles[type ?? "undefined"]

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
