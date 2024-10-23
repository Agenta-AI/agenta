import {
    _AgentaRootsResponse,
    NodeStatusCode,
    NodeStatusDTO,
    NodeType,
} from "@/services/observability/types"
import {Download, Gear, LineSegments, Sparkle, TreeStructure} from "@phosphor-icons/react"
import {Avatar} from "antd"
import React from "react"

type AvatarTreeContentProps = {
    value: _AgentaRootsResponse
} & React.ComponentProps<typeof Avatar>

export const nodeTypeStyles = {
    [NodeType.AGENT]: {
        bgColor: "#E6F4FF",
        color: "#4096FF",
        icon: Gear,
    },
    [NodeType.WORKFLOW]: {
        bgColor: "#586673",
        color: "#F5F7FA",
        icon: TreeStructure,
    },
    [NodeType.CHAIN]: {
        bgColor: "#E6F4FF",
        color: "#4096FF",
        icon: Gear,
    },
    [NodeType.TASK]: {
        bgColor: "#EAEFF5",
        color: "#586673",
        icon: TreeStructure,
    },
    [NodeType.TOOL]: {
        bgColor: "#F9F0FF",
        color: "#9254DE",
        icon: Download,
    },
    [NodeType.EMBEDDING]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    [NodeType.COMPLETION]: {
        bgColor: "#E6FFFB",
        color: "#13C2C2",
        icon: Sparkle,
    },
    [NodeType.QUERY]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    [NodeType.CHAT]: {
        bgColor: "#E6FFFB",
        color: "#13C2C2",
        icon: Sparkle,
    },
    [NodeType.RERANK]: {
        bgColor: "#FFFBE6",
        color: "#D4B106",
        icon: LineSegments,
    },
    default: {
        bgColor: "#586673",
        color: "#F5F7FA",
        icon: TreeStructure,
    },
}

export const statusMapper = (node: NodeType | null | undefined, status: NodeStatusDTO) => {
    const {code} = status
    const {bgColor, color, icon: Icon} = nodeTypeStyles[node ?? "default"]
    return {
        bgColor,
        color,
        icon: <Icon color={code === NodeStatusCode.ERROR ? "#D61010" : color} size={16} />,
    }
}

const AvatarTreeContent = ({value, ...props}: AvatarTreeContentProps) => {
    const {node, status} = value
    const {icon, bgColor, color} = statusMapper(node.type, status)

    return (
        <Avatar
            {...props}
            shape="square"
            size={"large"}
            style={{
                backgroundColor: status.code === NodeStatusCode.ERROR ? "#FBE7E7" : bgColor,
                width: 32,
                border: `1px solid ${status.code === NodeStatusCode.ERROR ? "#D61010" : color}`,
            }}
            icon={icon}
        />
    )
}

export default AvatarTreeContent