import {Skeleton} from "antd"

export const ConversationSkeleton = () => (
    <div className="conversation-body" aria-label="Loading conversation">
        <Skeleton active paragraph={{rows: 3}} />
        <Skeleton active paragraph={{rows: 2}} />
    </div>
)
