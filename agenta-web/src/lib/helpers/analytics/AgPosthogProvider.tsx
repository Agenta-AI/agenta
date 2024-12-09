import {useCallback, useEffect, useRef} from "react"
import {useRouter} from "next/router"
import {useAtom} from "jotai"
import {posthogAtom} from "./store/atoms"

const CustomPosthogProvider = ({children}: {children: React.ReactNode}) => {
    const router = useRouter()
    const loadingPosthog = useRef(false)
    const [posthogClient, setPosthogClient] = useAtom(posthogAtom)

    const initPosthog = useCallback(async () => {
        if (!!posthogClient) return
        if (loadingPosthog.current) return

        loadingPosthog.current = true

        const posthog = (await import("posthog-js")).default

        posthog.init(process.env.NEXT_PUBLIC_POSTHOG_API_KEY!, {
            api_host: "https://app.posthog.com",
            // Enable debug mode in development
            loaded: (posthog) => {
                console.log("initialized posthog", process.env.NEXT_PUBLIC_POSTHOG_API_KEY)
                setPosthogClient(posthog)
                if (process.env.NODE_ENV === "development") posthog.debug()
            },
            capture_pageview: false,
            persistence: "localStorage+cookie",
        })
    }, [posthogClient, setPosthogClient])

    useEffect(() => {
        initPosthog()
    }, [initPosthog])

    const handleRouteChange = useCallback(() => {
        posthogClient?.capture("$pageview", {$current_url: window.location.href})
    }, [posthogClient])

    useEffect(() => {
        router.events.on("routeChangeComplete", handleRouteChange)

        return () => {
            router.events.off("routeChangeComplete", handleRouteChange)
        }
    }, [handleRouteChange, router.events])

    return <>{children}</>
}

export default CustomPosthogProvider
