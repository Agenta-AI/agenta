import {useSession} from "@/hooks/useSession"
import Router, {useRouter} from "next/router"
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
        const startHandler = (newRoute: string) => {
            isBusy.current = true
        }
        const endHandler = (newRoute: string) => {
            isBusy.current = false
        }

        Router.events.on("routeChangeStart", startHandler)
        Router.events.on("routeChangeComplete", endHandler)
        return () => {
            Router.events.off("routeChangeStart", startHandler)
            Router.events.off("routeChangeComplete", endHandler)
        }
    }, [])

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
