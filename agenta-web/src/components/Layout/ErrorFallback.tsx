import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {Button, Result} from "antd"

interface Props {
    error: any
}

const ErrorFallback: React.FC<Props> = ({error}) => {
    return (
        <Result
            status="error"
            title="An Error Occurred"
            subTitle={getErrorMessage(error)}
            extra={[
                <Button key="home" href="/apps" type="primary">
                    Go to home screen
                </Button>,
            ]}
        />
    )
}

export default ErrorFallback
