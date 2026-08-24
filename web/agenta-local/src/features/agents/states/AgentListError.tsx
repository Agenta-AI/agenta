import {Alert, Button} from "antd"

export const AgentListError = ({retry}: {retry: () => void}) => (
    <Alert
        showIcon
        type="error"
        message="Agents could not be loaded"
        action={<Button onClick={retry}>Retry</Button>}
    />
)
