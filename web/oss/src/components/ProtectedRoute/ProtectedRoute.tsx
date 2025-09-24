import {type FC, type PropsWithChildren, useEffect, useRef, useState} from "react"

import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {selectedOrgAtom, selectedOrgQueryAtom} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

const ProtectedRoute: FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const {loading, doesSessionExist: isSignedIn} = useSession()
    const {pathname, query, asPath} = router
    const [shouldRender, setShouldRender] = useState(false)
    // Call to ensure project query mounts; values unused to avoid gating render
    useProjectData()
    const {user, loading: loadingProfile} = useProfileData()
    const isBusy = useRef(false)
    const {baseAppURL} = useURL()
    // Subscribe to selectedOrg to ensure the org query runs once enabled
    useAtomValue(selectedOrgAtom)
    // Also subscribe to the query atom object directly to mount the query itself
    useAtomValue(selectedOrgQueryAtom)

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
                // If user is signed in and this is an invite flow, route to accept when emails match
                const inviteFromStorage = JSON.parse(localStorage.getItem("invite") || "{}")
                const hasInviteToken = Boolean(query?.token) || Boolean(inviteFromStorage?.token)
                const inviteEmailParam = typeof query?.email === "string" ? query.email : undefined
                const inviteEmail = inviteEmailParam || inviteFromStorage?.email

                if (isSignedIn && hasInviteToken) {
                    const userEmail = user?.email?.toLowerCase?.()
                    const targetEmail = inviteEmail?.toLowerCase?.()
                    if (userEmail && targetEmail && userEmail === targetEmail) {
                        router.push({pathname: "/workspaces/accept", query})
                    } else {
                        // If signed-in user does not match invite email, avoid logging out; fall back to base app
                        router.push(baseAppURL)
                    }
                } else if (isSignedIn) {
                    router.push(baseAppURL)
                }
                setShouldRender(true)
            } else {
                if (!isSignedIn) {
                    router.push(`/auth?redirectToPath=${encodeURIComponent(asPath)}`)
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
