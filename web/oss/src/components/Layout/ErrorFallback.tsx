import {useEffect} from "react"

import {Button, Result} from "antd"
import {useRouter} from "next/router"
import {FallbackProps} from "react-error-boundary"

import {getErrorMessage} from "@/oss/lib/helpers/errorHandler"

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
                // TODO: REPLACE WITH NEXT/LINK
                <Button key="home" href="/apps" type="primary">
                    Go to home screen
                </Button>,
            ]}
        />
    )
}

export default ErrorFallback
