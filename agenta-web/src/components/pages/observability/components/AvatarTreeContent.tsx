import {_AgentaRootsResponse, NodeStatusDTO, NodeType} from "@/services/observability/types"
import {
    ArrowsCounterClockwise,
    ArrowsDownUp,
    Download,
    GearFine,
    LineSegments,
    ListDashes,
    Sparkle,
    StarFour,
    TreeStructure,
    Wrench,
} from "@phosphor-icons/react"
import {Avatar} from "antd"
import React from "react"

type AvatarTreeContentProps = {
    value: _AgentaRootsResponse
} & React.ComponentProps<typeof Avatar>

export const nodeTypeStyles = {
    [NodeType.AGENT]: {
        bgColor: "#F6F6FD",
        color: "#7D7DDB",
        icon: TreeStructure,
    },
    [NodeType.WORKFLOW]: {
        bgColor: "#FFF8F5",
        color: "#F6875A",
        icon: LineSegments,
    },
    [NodeType.CHAIN]: {
        bgColor: "#F5F1FE",
        color: "#9D79E8",
        icon: ListDashes,
    },
    [NodeType.TASK]: {
        bgColor: "#F0FAF0",
        color: "#228B22",
        icon: GearFine,
    },
    [NodeType.TOOL]: {
        bgColor: "#FEF5FB",
        color: "#E175BD",
        icon: Wrench,
    },
    [NodeType.EMBEDDING]: {
        bgColor: "#F0FDFD",
        color: "#008080",
        icon: ArrowsCounterClockwise,
    },
    [NodeType.COMPLETION]: {
        bgColor: "#EDF8FD",
        color: "#63ADCB",
        icon: StarFour,
    },
    [NodeType.QUERY]: {
        bgColor: "#FCFAEE",
        color: "#D6B507",
        icon: Download,
    },
    [NodeType.CHAT]: {
        bgColor: "#EAFDEA",
        color: "#36D16A",
        icon: Sparkle,
    },
    [NodeType.RERANK]: {
        bgColor: "#F9F9FC",
        color: "#8C92A3",
        icon: ArrowsDownUp,
    },
    default: {
        bgColor: "#F9F9FC",
        color: "#8C92A3",
        icon: TreeStructure,
    },
}

export const statusMapper = (node: NodeType | null | undefined, status: NodeStatusDTO) => {
    const {code} = status
    const {bgColor, color, icon: Icon} = nodeTypeStyles[node ?? "default"]
    return {
        bgColor,
        color,
        icon: <Icon color={code === "ERROR" ? "#D61010" : color} size={16} />,
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
                backgroundColor: status.code === "ERROR" ? "#FBE7E7" : bgColor,
                width: 32,
                border: `1px solid ${status.code === "ERROR" ? "#D61010" : color}`,
            }}
            icon={icon}
        />
    )
}

export default AvatarTreeContent
