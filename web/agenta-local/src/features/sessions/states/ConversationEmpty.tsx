import {CommentOutlined} from "@ant-design/icons"
import {Empty, Typography} from "antd"

export const ConversationEmpty = () => (
    <div className="conversation-state">
        <Empty image={<CommentOutlined className="empty-icon" />} description={null}>
            <Typography.Title level={4}>Choose a session</Typography.Title>
            <Typography.Paragraph type="secondary">
                Select a conversation or start a new one with an agent.
            </Typography.Paragraph>
        </Empty>
    </div>
)
