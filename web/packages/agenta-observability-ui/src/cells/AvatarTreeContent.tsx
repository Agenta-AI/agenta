import type {SpanCategory} from "@agenta/entities/trace"
import {cn} from "@agenta/ui/styles"

import {spanTypeStyles} from "../assets/spanTypeStyles"

export const statusMapper = (span: SpanCategory | null | undefined) => {
    const {bgColor, color, icon: Icon} = spanTypeStyles[span ?? "unknown"] ?? spanTypeStyles.unknown
    return {
        bgColor,
        color,
        icon: <Icon color={color} size={16} />,
    }
}

interface Props {
    value?: {span_type?: SpanCategory | null} | null
    className?: string
}

/** antd `Avatar` replacement — a fixed 24px square holding the span-type glyph. */
export const AvatarTreeContent = ({value, className}: Props) => {
    const {span_type} = value || {}
    const {icon} = statusMapper(span_type)

    return (
        <div
            className={cn(
                "inline-grid place-items-center size-6 shrink-0 rounded bg-transparent",
                className,
            )}
        >
            {icon}
        </div>
    )
}

export default AvatarTreeContent
