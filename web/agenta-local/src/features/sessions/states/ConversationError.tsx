import {Alert, Button} from "antd"

export const ConversationError = ({retry}: {retry: () => void}) => (
    <div className="conversation-state">
        <Alert
            showIcon
            type="error"
            message="Conversation could not be loaded"
            action={<Button onClick={retry}>Retry</Button>}
        />
    </div>
)
