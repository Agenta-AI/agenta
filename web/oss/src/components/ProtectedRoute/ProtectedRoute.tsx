import {type PropsWithChildren, type FC, useEffect, useRef, useState} from "react"

import {useRouter} from "next/router"

import {useProfileData} from "@/oss/contexts/profile.context"
import {useProjectData} from "@/oss/contexts/project.context"
import {useSession} from "@/oss/hooks/useSession"

const ProtectedRoute: FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const {loading, doesSessionExist: isSignedIn, logout} = useSession()
    const {pathname, query} = router
    const [shouldRender, setShouldRender] = useState(false)
    const {isLoading, isProjectId} = useProjectData()
    const {user, loading: loadingProfile} = useProfileData()
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
        if (loading || isLoading || loadingProfile) {
            setShouldRender(false)
        } else {
            if (pathname.startsWith("/auth")) {
                const _email = !query.email
                    ? JSON.parse(localStorage.getItem("invite") || "{}")?.email
                    : query.email

                if (user && _email && user?.email == _email) {
                    router.push({pathname: "/workspaces/accept", query})
                } else if (user && _email && user?.email !== _email) {
                    logout()
                } else if (isSignedIn) {
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
    }, [pathname, isSignedIn, loading, isProjectId, isLoading, router, user])

    return shouldRender ? children : null
}

export default ProtectedRoute
