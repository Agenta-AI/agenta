import {Avatar} from "antd"

import {NodeType} from "@/oss/services/observability/types"

import {nodeTypeStyles} from "../assets/constants"
import {AvatarTreeContentProps} from "../assets/types"

export const statusMapper = (node: NodeType | null | undefined) => {
    const {bgColor, color, icon: Icon} = nodeTypeStyles[node ?? "default"]
    return {
        bgColor,
        color,
        icon: <Icon color={color} size={16} />,
    }
}

const AvatarTreeContent = ({value, ...props}: AvatarTreeContentProps) => {
    const {node} = value || {}
    const {icon} = statusMapper(node?.type)

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
