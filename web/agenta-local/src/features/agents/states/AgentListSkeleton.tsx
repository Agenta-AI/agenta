import {Skeleton} from "antd"

export const AgentListSkeleton = () => (
    <div className="list-state" aria-label="Loading agents">
        <Skeleton active paragraph={{rows: 2}} />
        <Skeleton active paragraph={{rows: 2}} />
        <Skeleton active paragraph={{rows: 2}} />
    </div>
)
