import type {FC} from "react"

import {Result, Button} from "antd"

interface ErrorStateProps {
    title?: string
    subtitle?: string
    status?: "error" | "warning" | "info" | "500"
    onRetry?: () => void
}

const ErrorState: FC<ErrorStateProps> = ({
    title = "Something went wrong",
    subtitle = "Please try again",
    status = "error",
    onRetry,
}) => {
    return (
        <Result
            status={status}
            title={title}
            subTitle={subtitle}
            extra={
                onRetry ? (
                    <Button type="primary" onClick={onRetry} data-testid="error-retry">
                        Retry
                    </Button>
                ) : null
            }
        />
    )
}

export default ErrorState
