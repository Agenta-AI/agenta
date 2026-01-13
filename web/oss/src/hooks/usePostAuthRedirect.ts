import {useCallback, useMemo} from "react"

import {getDefaultStore, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import Session, {signOut} from "supertokens-auth-react/recipe/session"
import {useLocalStorage} from "usehooks-ts"

import {queryClient} from "@/oss/lib/api/queryClient"
import {isDemo} from "@/oss/lib/helpers/utils"
import {mergeSessionIdentities} from "@/oss/services/auth/api"
import {fetchAllOrgsList} from "@/oss/services/organization/api"
import {orgsAtom, useOrgData} from "@/oss/state/org"
import {resolvePreferredWorkspaceId} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {useProjectData} from "@/oss/state/project"
import {authFlowAtom} from "@/oss/state/session"
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
    const setAuthFlow = useSetAtom(authFlowAtom)
    const [invite] = useLocalStorage<Record<string, unknown>>("invite", {})
    const authUpgradeOrgKey = "authUpgradeOrgId"
    const lastSsoOrgSlugKey = "lastSsoOrgSlug"

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
            // Auth completed successfully; resume normal data fetching.
            setAuthFlow("authed")
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

            if (typeof window !== "undefined") {
                const upgradeOrgId = window.localStorage.getItem(authUpgradeOrgKey)
                const rawSessionIdentities = window.localStorage.getItem(
                    "authUpgradeSessionIdentities",
                )
                if (upgradeOrgId || rawSessionIdentities) {
                    console.debug("[auth-upgrade] redirect target", {
                        upgradeOrgId,
                        hasSessionIdentities: Boolean(rawSessionIdentities),
                    })
                }
                if (rawSessionIdentities) {
                    try {
                        const parsed = JSON.parse(rawSessionIdentities)
                        const list = Array.isArray(parsed) ? parsed : []
                        if (list.length > 0) {
                            try {
                                const result = await mergeSessionIdentities(list)
                                console.debug("[auth-upgrade] session identities merged", {
                                    list,
                                    result,
                                })
                                window.localStorage.removeItem("authUpgradeSessionIdentities")
                            } catch (error) {
                                console.error(
                                    "[auth-upgrade] session identities merge failed",
                                    error,
                                )
                            }
                        }
                    } catch {
                        // ignore parse failures
                    }
                }
                if (upgradeOrgId) {
                    await resetAuthState()
                    await router.replace(`/w/${encodeURIComponent(upgradeOrgId)}`)
                    return
                }
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
                let lastSsoSlug =
                    typeof window !== "undefined"
                        ? window.localStorage.getItem(lastSsoOrgSlugKey)
                        : null
                try {
                    const payload = await Session.getAccessTokenPayloadSecurely()
                    const sessionIdentities =
                        payload?.session_identities || payload?.sessionIdentities || []
                    const ssoIdentity = Array.isArray(sessionIdentities)
                        ? sessionIdentities.find((identity: string) => identity.startsWith("sso:"))
                        : null
                    if (!ssoIdentity) {
                        // Social/email logins should not reuse a stale SSO target from storage.
                        if (typeof window !== "undefined") {
                            window.localStorage.removeItem(lastSsoOrgSlugKey)
                        }
                        lastSsoSlug = null
                    } else if (!lastSsoSlug) {
                        const [, orgSlug] = ssoIdentity.split(":")
                        if (orgSlug) {
                            lastSsoSlug = orgSlug
                        }
                    }
                } catch {
                    // ignore payload lookup failures
                }
                if (lastSsoSlug) {
                    const match = Array.isArray(freshOrgs)
                        ? freshOrgs.find((org) => org.slug === lastSsoSlug)
                        : null
                    if (match?.id && match.flags?.allow_sso) {
                        // If we just completed an SSO flow, prefer the SSO org over Personal.
                        // This avoids a brief redirect to Personal that can trigger
                        // "requires email/social" when the session only has sso:*.
                        window.localStorage.removeItem(lastSsoOrgSlugKey)
                        await router.replace(`/w/${encodeURIComponent(match.id)}`)
                        return
                    }
                    if (match?.id && !match.flags?.allow_sso) {
                        // SSO succeeded but the org is not SSO-enabled: sign out and return to /auth.
                        window.localStorage.removeItem(lastSsoOrgSlugKey)
                        const query = new URLSearchParams({
                            auth_error: "sso_denied",
                            auth_message:
                                "SSO was successful but is currently disabled for this organization. Please sign in using another method or contact your administrator.",
                        })
                        try {
                            await signOut()
                        } catch {
                            // ignore sign-out failures
                        }
                        await router.replace(`/auth?${query.toString()}`)
                        return
                    }
                }
                // No SSO-specific org - use preferred workspace resolution
                const preferredWorkspaceId = resolvePreferredWorkspaceId(userId, freshOrgs)
                if (preferredWorkspaceId) {
                    await router.replace(`/w/${encodeURIComponent(preferredWorkspaceId)}`)
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
