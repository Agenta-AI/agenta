import {useCallback, useMemo} from "react"

import {getDefaultStore} from "jotai"
import {useRouter} from "next/router"
import {useLocalStorage} from "usehooks-ts"

import {isDemo} from "@/oss/lib/helpers/utils"
import {queryClient} from "@/oss/lib/api/queryClient"
import {fetchAllOrgsList} from "@/oss/services/organization/api"
import {orgsAtom, useOrgData} from "@/oss/state/org"
import {isPersonalOrg, resolvePreferredWorkspaceId} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {useProjectData} from "@/oss/state/project"
import {buildPostLoginPath, waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

interface AuthUserLike {
    createdNewRecipeUser?: boolean
    user?: {
        loginMethods?: unknown[]
    }
}

interface HandleAuthSuccessOptions {
    isInvitedUser?: boolean
}

const usePostAuthRedirect = () => {
    const router = useRouter()
    const {refetch: resetProfileData} = useProfileData()
    const {refetch: resetOrgData} = useOrgData()
    const {reset: resetProjectData} = useProjectData()
    const [invite] = useLocalStorage<Record<string, unknown>>("invite", {})

    const hasInviteFromQuery = useMemo(() => {
        const token = router.query?.token
        if (Array.isArray(token)) {
            return token.length > 0
        }
        return Boolean(token)
    }, [router.query])

    const hasInviteFromStorage = useMemo(() => {
        if (!invite) return false
        return Object.keys(invite).length > 0
    }, [invite])

    const derivedIsInvitedUser = hasInviteFromQuery || hasInviteFromStorage

    const resetAuthState = useCallback(async () => {
        await resetProfileData()
        await resetOrgData()
        await resetProjectData()
    }, [resetOrgData, resetProfileData, resetProjectData])

    const handleAuthSuccess = useCallback(
        async (authResult: AuthUserLike, options?: HandleAuthSuccessOptions) => {
            const isInvitedUser = options?.isInvitedUser ?? derivedIsInvitedUser
            const loginMethodCount = authResult?.user?.loginMethods?.length ?? 0
            const isNewUser =
                isDemo() && Boolean(authResult?.createdNewRecipeUser) && loginMethodCount === 1

            if (isNewUser) {
                if (isInvitedUser) {
                    await router.push("/workspaces/accept?survey=true")
                } else {
                    await resetAuthState()
                    await router.push("/post-signup")
                }
                return
            }

            if (isInvitedUser) {
                await router.push("/workspaces/accept")
                return
            }

            await resetAuthState()

            const store = getDefaultStore()
            const userId = (store.get(userAtom) as {id?: string} | null)?.id ?? null

            try {
                const freshOrgs = await queryClient.fetchQuery({
                    queryKey: ["orgs", userId || ""],
                    queryFn: () => fetchAllOrgsList(),
                    staleTime: 60_000,
                })
                const personal = Array.isArray(freshOrgs)
                    ? freshOrgs.find((org) => isPersonalOrg(org))
                    : null
                if (personal?.id) {
                    await router.replace(`/w/${encodeURIComponent(personal.id)}`)
                    return
                }
            } catch {
                // fall back to workspace context
            }

            let context = await waitForWorkspaceContext({requireProjectId: false})

            if (!context.workspaceId) {
                const fallbackWorkspace = resolvePreferredWorkspaceId(userId, store.get(orgsAtom))
                if (fallbackWorkspace) {
                    context = {workspaceId: fallbackWorkspace, projectId: null}
                }
            }

            const nextPath = buildPostLoginPath(context)
            await router.replace(nextPath)
        },
        [derivedIsInvitedUser, resetAuthState, router],
    )

    return {
        handleAuthSuccess,
        resetAuthState,
        isInvitedUser: derivedIsInvitedUser,
    }
}

export default usePostAuthRedirect
