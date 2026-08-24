import {StopOutlined} from "@ant-design/icons"
import {Button} from "antd"

export const StopButton = ({stopping, stop}: {stopping: boolean; stop: () => void}) => (
    <Button
        danger
        icon={<StopOutlined />}
        loading={stopping}
        onClick={stop}
        aria-label="Stop agent turn"
    >
        Stop
    </Button>
)
