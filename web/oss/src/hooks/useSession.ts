import {useEffect} from "react"

import {useSetAtom} from "jotai"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {resetOrgData} from "@/oss/state/org"
import {resetProfileData} from "@/oss/state/profile"
import {resetProjectData} from "@/oss/state/project"
import {sessionExistsAtom, sessionLoadingAtom} from "@/oss/state/session"

export const useSession: () => {
    loading: boolean
    doesSessionExist: boolean
    logout: () => Promise<void>
} = () => {
    const res = useSessionContext()
    const setSessionExists = useSetAtom(sessionExistsAtom)
    const setSessionLoading = useSetAtom(sessionLoadingAtom)
    const router = useRouter()
    const queryClient = useQueryClient()

    useEffect(() => {
        setSessionLoading(res.loading)
        if (!res.loading) {
            setSessionExists((res as any).doesSessionExist)
        }
    }, [res.loading, (res as any).doesSessionExist, setSessionExists, setSessionLoading])

    return {
        loading: res.loading,
        doesSessionExist: (res as any).doesSessionExist,
        logout: async () => {
            signOut()
                .then(async () => {
                    // Clear React Query cache to prevent unauthorized requests
                    queryClient.clear()

                    // Reset Jotai atoms
                    resetProfileData()
                    resetOrgData()
                    resetProjectData()

                    // Reset analytics
                    const posthog = (await import("posthog-js")).default
                    posthog.reset()

                    // Update session state
                    setSessionExists(false)

                    // Redirect to auth page
                    router.push("/auth")
                })
                .catch(console.error)
        },
    }
}
