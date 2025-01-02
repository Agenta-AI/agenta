import {useSession} from "@/hooks/useSession"
import {useRouter} from "next/router"
import React, {PropsWithChildren, useEffect, useRef, useState} from "react"
import {useProjectData} from "@/contexts/project.context"

const ProtectedRoute: React.FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const {loading, doesSessionExist: isSignedIn} = useSession()
    const {pathname} = router
    const [shouldRender, setShouldRender] = useState(false)
    const {isLoading, isProjectId} = useProjectData()
    const isBusy = useRef(false)

    useEffect(() => {
        const startHandler = (_newRoute: string) => (isBusy.current = true)
        const endHandler = (_newRoute: string) => (isBusy.current = false)

        router.events.on("routeChangeStart", startHandler)
        router.events.on("routeChangeComplete", endHandler)
        return () => {
            router.events.off("routeChangeStart", startHandler)
            router.events.off("routeChangeComplete", endHandler)
        }
    }, [router])

    useEffect(() => {
        if (isBusy.current) return
        if (loading || isLoading) {
            setShouldRender(false)
        } else {
            if (pathname.startsWith("/auth")) {
                if (isSignedIn) {
                    router.push("/apps")
                }
                setShouldRender(true)
            } else {
                if (!isSignedIn) {
                    router.push(
                        `/auth?redirectToPath=${encodeURIComponent(
                            `${pathname}${window.location.search}`,
                        )}`,
                    )
                }
                setShouldRender(!!isProjectId)
            }
        }
    }, [pathname, isSignedIn, loading, isProjectId, isLoading, router])

    return <>{shouldRender ? children : null}</>
}

export default ProtectedRoute
