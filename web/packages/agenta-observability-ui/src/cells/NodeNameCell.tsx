import {memo} from "react"

import type {SpanCategory} from "@agenta/entities/trace"

import {spanTypeStyles} from "../assets/spanTypeStyles"

interface Props {
    name?: string | null
    type?: SpanCategory | null
}

export const NodeNameCell = memo(({name, type}: Props) => {
    const {icon: Icon} = spanTypeStyles[type ?? "unknown"] ?? spanTypeStyles.unknown

    return (
        <div className="flex items-center gap-1 min-w-0">
            <div className="grid place-items-center shrink-0">
                <Icon size={16} />
            </div>
            {/* native title carries the full name, replacing antd's ellipsis tooltip */}
            <span className="flex-1 min-w-0 truncate text-xs" title={name ?? undefined}>
                {name}
            </span>
        </div>
    )
})

export default NodeNameCell
