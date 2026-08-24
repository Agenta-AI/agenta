import {Tag} from "antd"

export const AgentRevisionBadge = ({version}: {version: number}) => (
    <Tag className="revision-tag">v{version}</Tag>
)
