import {Avatar} from "antd"

import {AvatarTreeContentProps} from "../assets/types"
import {spanTypeStyles} from "../assets/constants"
import {SpanCategory} from "@/oss/services/tracing/types"

export const statusMapper = (span: SpanCategory | null | undefined) => {
    const {bgColor, color, icon: Icon} = spanTypeStyles[span ?? "undefined"]
    return {
        bgColor,
        color,
        icon: <Icon color={color} size={16} />,
    }
}

const AvatarTreeContent = ({value, ...props}: AvatarTreeContentProps) => {
    const {span_type} = value || {}
    const {icon} = statusMapper(span_type)

    return (
        <Avatar
            {...props}
            shape="square"
            size="small"
            style={{backgroundColor: "transparent"}}
            icon={icon}
        />
    )
}

export default AvatarTreeContent
