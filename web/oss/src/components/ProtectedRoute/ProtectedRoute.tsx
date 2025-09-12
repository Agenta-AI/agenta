import {type PropsWithChildren, type FC, useEffect, useRef, useState} from "react"

import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useSession} from "@/oss/hooks/useSession"
import {selectedOrgAtom, selectedOrgQueryAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

const ProtectedRoute: FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const {loading, doesSessionExist: isSignedIn, logout} = useSession()
    const {pathname, query} = router
    const [shouldRender, setShouldRender] = useState(false)
    // Call to ensure project query mounts; values unused to avoid gating render
    useProjectData()
    const {user, loading: loadingProfile} = useProfileData()
    const isBusy = useRef(false)
    // Subscribe to selectedOrg to ensure the org query runs once enabled
    const selectedOrg = useAtomValue(selectedOrgAtom)
    // Also subscribe to the query atom object directly to mount the query itself
    const selectedOrgQuery = useAtomValue(selectedOrgQueryAtom)

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
        // Avoid blocking render on project loading to prevent flash
        if (loading || loadingProfile) {
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
                    // router.push("/apps")
                }
                setShouldRender(true)
            } else {
                if (!isSignedIn) {
                    router.push(
                        `/auth?redirectToPath=${encodeURIComponent(
                            `${pathname}${window.location.search}`,
                        )}`,
                    )
                    setShouldRender(false)
                } else {
                    // Always render once authenticated; downstream components gate their own data
                    setShouldRender(true)
                }
            }
        }
    }, [pathname, isSignedIn, loading, router, user, loadingProfile])

    return shouldRender ? children : null
}

export default ProtectedRoute
