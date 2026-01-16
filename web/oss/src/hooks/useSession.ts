import {useEffect} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {resetOrganizationData} from "@/oss/state/org"
import {resetProfileData} from "@/oss/state/profile"
import {resetProjectData} from "@/oss/state/project"
import {authFlowAtom, sessionExistsAtom, sessionLoadingAtom} from "@/oss/state/session"

export const useSession: () => {
    loading: boolean
    doesSessionExist: boolean
    logout: () => Promise<void>
} = () => {
    const res = useSessionContext()
    const setSessionExists = useSetAtom(sessionExistsAtom)
    const setSessionLoading = useSetAtom(sessionLoadingAtom)
    const setAuthFlow = useSetAtom(authFlowAtom)
    const authFlow = useAtomValue(authFlowAtom)
    const router = useRouter()
    const queryClient = useQueryClient()

    useEffect(() => {
        setSessionLoading(res.loading)
        if (!res.loading) {
            setSessionExists((res as any).doesSessionExist)
            if (authFlow !== "authing") {
                setAuthFlow((res as any).doesSessionExist ? "authed" : "unauthed")
            }
        }
    }, [
        res.loading,
        (res as any).doesSessionExist,
        setSessionExists,
        setSessionLoading,
        setAuthFlow,
        authFlow,
    ])

    return {
        loading: res.loading,
        doesSessionExist: (res as any).doesSessionExist,
        logout: async () => {
            try {
                await signOut()
            } catch (error) {
                console.error(error)
            }

            // Clear React Query cache to prevent unauthorized requests
            queryClient.clear()

            // Reset Jotai atoms
            resetProfileData()
            resetOrganizationData()
            resetProjectData()

            // Reset analytics
            const posthog = (await import("posthog-js")).default
            posthog.reset()

            if (typeof window !== "undefined") {
                window.localStorage.removeItem("authUpgradeOrgId")
                window.localStorage.removeItem("authUpgradeSessionIdentities")
                window.localStorage.removeItem("workspaceOrgMap")
                window.localStorage.removeItem("lastUsedWorkspaceId")
            }

            // Update session state
            setSessionExists(false)
            setAuthFlow("unauthed")

            // Redirect to auth page
            await router.replace("/auth")
        },
    }
}
