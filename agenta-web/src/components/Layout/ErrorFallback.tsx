import {getErrorMessage} from "@/lib/helpers/errorHandler"
import {Button, Result} from "antd"
import {useRouter} from "next/router"
import {useEffect} from "react"
import {FallbackProps} from "react-error-boundary"

const ErrorFallback: React.FC<FallbackProps> = ({error, resetErrorBoundary}) => {
    const router = useRouter()

    useEffect(() => {
        const handleRouteChange = () => {
            resetErrorBoundary()
        }
        router.events.on("routeChangeComplete", handleRouteChange)
        return () => {
            router.events.off("routeChangeComplete", handleRouteChange)
        }
    }, [])

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
