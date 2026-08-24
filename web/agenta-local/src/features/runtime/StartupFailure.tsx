import {Alert, Button} from "antd"

export const StartupFailure = ({retry}: {retry: () => void}) => (
    <div className="center-state">
        <Alert
            showIcon
            type="error"
            message="Agenta Local could not start"
            description="The renderer could not connect to the local service. Check the launcher log and try again."
            action={<Button onClick={retry}>Try again</Button>}
        />
    </div>
)
