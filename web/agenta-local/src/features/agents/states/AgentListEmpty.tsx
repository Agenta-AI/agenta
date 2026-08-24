import {RobotOutlined} from "@ant-design/icons"
import {Button, Empty} from "antd"

export const AgentListEmpty = ({create}: {create: () => void}) => (
    <Empty
        image={<RobotOutlined className="empty-icon" />}
        description={
            <>
                <strong>No agents yet</strong>
                <span>Create a focused assistant with its own instructions.</span>
            </>
        }
    >
        <Button type="primary" onClick={create}>
            Create your first agent
        </Button>
    </Empty>
)
