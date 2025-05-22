import {useRouter} from "next/router"
import {useSessionContext} from "supertokens-auth-react/recipe/session"
import {signOut} from "supertokens-auth-react/recipe/session"

import {useOrgData} from "@/oss/contexts/org.context"
import {useProfileData} from "@/oss/contexts/profile.context"
import {useProjectData} from "@/oss/contexts/project.context"

export const useSession: () => {
    loading: boolean
    doesSessionExist: boolean
    logout: () => void
} = () => {
    const res = useSessionContext()
    const router = useRouter()
    const {reset: resetProfileData} = useProfileData()
    const {reset: resetOrgData} = useOrgData()
    const {reset: resetProjectData} = useProjectData()

    return {
        loading: res.loading,
        doesSessionExist: (res as any).doesSessionExist,
        logout: () => {
            signOut()
                .then(async () => {
                    const posthog = (await import("posthog-js")).default
                    posthog.reset()
                    resetProfileData()
                    resetOrgData()
                    resetProjectData()
                    router.push("/auth")
                })
                .catch(console.error)
        },
    }
}
