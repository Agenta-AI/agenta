import {useEffect} from "react"

import {useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {signOut} from "supertokens-auth-react/recipe/session"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {resetOrgData} from "@/oss/state/org"
import {resetProfileData} from "@/oss/state/profile"
import {resetProjectData} from "@/oss/state/project"
import {sessionExistsAtom} from "@/oss/state/session"

export const useSession: () => {
    loading: boolean
    doesSessionExist: boolean
    logout: () => void
} = () => {
    const res = useSessionContext()
    const setSessionExists = useSetAtom(sessionExistsAtom)
    const router = useRouter()

    useEffect(() => {
        if (!res.loading) {
            setSessionExists((res as any).doesSessionExist)
        }
    }, [res.loading, (res as any).doesSessionExist, setSessionExists])

    return {
        loading: res.loading,
        doesSessionExist: (res as any).doesSessionExist,
        logout: () => {
            signOut()
                .then(async () => {
                    const posthog = (await import("posthog-js")).default
                    posthog.reset()
                    setSessionExists(false)
                    resetProfileData()
                    resetOrgData()
                    resetProjectData()
                    router.push("/auth")
                })
                .catch(console.error)
        },
    }
}
