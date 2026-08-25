import {useEffect} from "react"

import {Button} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"
import Link from "next/link"
import {useRouter} from "next/router"
import {FallbackProps} from "react-error-boundary"

import useURL from "@/oss/hooks/useURL"
import {getErrorMessage} from "@/oss/lib/helpers/errorHandler"

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
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <WarningCircle size={48} weight="fill" className="text-colorError" />
            <h2 className="m-0 text-base font-semibold text-colorText">An Error Occurred</h2>
            <p className="m-0 max-w-[480px] text-xs text-colorTextSecondary">
                {getErrorMessage(error)}
            </p>
            <Link href={baseAppURL || "/"}>
                <Button>Go to home screen</Button>
            </Link>
        </div>
    )
}

export default ErrorFallback
