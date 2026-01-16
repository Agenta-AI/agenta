import {useCallback, useMemo} from "react"

import {getDefaultStore, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import Session, {signOut} from "supertokens-auth-react/recipe/session"
import {useLocalStorage} from "usehooks-ts"

import {queryClient} from "@/oss/lib/api/queryClient"
import {filterOrgsByAuthMethod} from "@/oss/lib/helpers/authMethodFilter"
import {isEE} from "@/oss/lib/helpers/isEE"
import {isNewUserAtom} from "@/oss/lib/onboarding/atoms"
import {mergeSessionIdentities} from "@/oss/services/auth/api"
import {fetchAllOrgsList} from "@/oss/services/organization/api"
import {orgsAtom, useOrgData} from "@/oss/state/org"
import {resolvePreferredWorkspaceId} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {userAtom} from "@/oss/state/profile/selectors/user"
import {useProjectData} from "@/oss/state/project"
import {authFlowAtom} from "@/oss/state/session"
import {writePostSignupPending} from "@/oss/state/url/auth"
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
    const {refetch: resetOrganizationData} = useOrgData()
    const {reset: resetProjectData} = useProjectData()
    const setAuthFlow = useSetAtom(authFlowAtom)
    const [invite] = useLocalStorage<Record<string, unknown>>("invite", {})
    const authUpgradeOrgKey = "authUpgradeOrgId"
    const lastSsoOrgSlugKey = "lastSsoOrgSlug"
    const setIsNewUser = useSetAtom(isNewUserAtom)

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
        await resetOrganizationData()
        await resetProjectData()
    }, [resetProfileData, resetOrganizationData, resetProjectData])

    const handleAuthSuccess = useCallback(
        async (authResult: AuthUserLike, options?: HandleAuthSuccessOptions) => {
            // Auth completed successfully; resume normal data fetching.
            setAuthFlow("authed")
            const isInvitedUser = options?.isInvitedUser ?? derivedIsInvitedUser

            // Read is_new_user from session payload (set by backend overrides)
            let isNewUser = false
            let payload: any = null
            try {
                payload = await Session.getAccessTokenPayloadSecurely()
                isNewUser = Boolean(payload?.is_new_user)
            } catch {
                // Fallback to createdNewRecipeUser if payload unavailable (EE only)
                isNewUser = isEE() && Boolean(authResult?.createdNewRecipeUser)
            }

            console.log("[post-auth] handleAuthSuccess", {
                isEE: isEE(),
                createdNewRecipeUser: authResult?.createdNewRecipeUser,
                payloadIsNewUser: payload?.is_new_user,
                isNewUser,
                isInvitedUser,
                loginMethods: authResult?.user?.loginMethods,
                fullPayload: payload,
            })

            if (isNewUser) {
                if (isInvitedUser) {
                    console.log("[post-auth] redirect invited new user -> /workspaces/accept")
                    await router.push("/workspaces/accept?survey=true")
                } else {
                    console.log("[post-auth] redirect new user -> /post-signup")
                    writePostSignupPending()
                    await resetAuthState()
                    setIsNewUser(true)
                    await router.push("/post-signup")
                }
                return
            }

            if (isInvitedUser) {
                console.log("[post-auth] redirect invited user -> /workspaces/accept")
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

            // Store compatible orgs outside try-catch so fallback can use them
            let compatibleOrgs: typeof orgsAtom extends Atom<infer T> ? T : never = []

            try {
                const freshOrgs = await queryClient.fetchQuery({
                    queryKey: ["orgs", userId || ""],
                    queryFn: () => fetchAllOrgsList(),
                    staleTime: 60_000,
                })

                // Get session identities to filter orgs by auth method compatibility
                let sessionIdentities: string[] = []
                let lastSsoSlug =
                    typeof window !== "undefined"
                        ? window.localStorage.getItem(lastSsoOrgSlugKey)
                        : null

                try {
                    const payload = await Session.getAccessTokenPayloadSecurely()
                    sessionIdentities =
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

                // Filter organizations by auth method compatibility
                // This prevents redirecting users to orgs they can't access with their current auth method
                compatibleOrgs = filterOrgsByAuthMethod(freshOrgs, sessionIdentities)

                console.log("[post-auth] Organization filtering", {
                    totalOrgs: freshOrgs.length,
                    compatibleOrgs: compatibleOrgs.length,
                    sessionIdentities,
                    filteredOutCount: freshOrgs.length - compatibleOrgs.length,
                })

                // Check for SSO-specific org (using compatible orgs only)
                if (lastSsoSlug) {
                    const match = Array.isArray(compatibleOrgs)
                        ? compatibleOrgs.find((org) => org.slug === lastSsoSlug)
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

                // Use preferred workspace resolution with ONLY compatible orgs
                const preferredWorkspaceId = resolvePreferredWorkspaceId(userId, compatibleOrgs)
                if (preferredWorkspaceId) {
                    await router.replace(`/w/${encodeURIComponent(preferredWorkspaceId)}`)
                    return
                }

                // Fallback: If user has orgs but none are compatible with their auth method
                if (freshOrgs.length > 0 && compatibleOrgs.length === 0) {
                    console.warn(
                        "[post-auth] User has organizations but none are compatible with their auth method",
                        {
                            totalOrgs: freshOrgs.length,
                            sessionIdentities,
                        },
                    )
                    // Redirect to auth page with helpful message
                    const query = new URLSearchParams({
                        auth_error: "no_compatible_orgs",
                        auth_message:
                            "None of your organizations accept the authentication method you used. Please sign in with a different method or contact your administrator.",
                    })
                    await router.replace(`/auth?${query.toString()}`)
                    return
                }
            } catch (error) {
                // fall back to workspace context
                console.warn("[post-auth] Error during org filtering, falling back", error)
            }

            let context = await waitForWorkspaceContext({requireProjectId: false})

            if (!context.workspaceId) {
                // Use compatible orgs if available, otherwise fall back to all orgs
                const orgsToUse = compatibleOrgs.length > 0 ? compatibleOrgs : store.get(orgsAtom)
                const fallbackWorkspace = resolvePreferredWorkspaceId(userId, orgsToUse)
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
