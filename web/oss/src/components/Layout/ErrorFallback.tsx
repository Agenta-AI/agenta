import {useEffect} from "react"

import {Button, Result} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"
import {FallbackProps} from "react-error-boundary"

import {getErrorMessage} from "@/oss/lib/helpers/errorHandler"
import useURL from "@/oss/hooks/useURL"

const ErrorFallback: React.FC<FallbackProps> = ({error, resetErrorBoundary}) => {
    const router = useRouter()
    const {baseAppURL} = useURL()

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
                <Link key="home" href={baseAppURL || "/"}>
                    <Button type="primary">Go to home screen</Button>
                </Link>,
            ]}
        />
    )
}

export default ErrorFallback
