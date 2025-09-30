import {useEffect} from "react"

import {useSetAtom} from "jotai"
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
                    resetProfileData()
                    resetOrgData()
                    resetProjectData()
                    const posthog = (await import("posthog-js")).default
                    posthog.reset()
                    setSessionExists(false)
                    router.push("/auth")
                })
                .catch(console.error)
        },
    }
}
