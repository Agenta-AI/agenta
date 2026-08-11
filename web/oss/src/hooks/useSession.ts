import {useEffect} from "react"

import {clearPersistedQueryCache} from "@agenta/shared/api/persist"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import Session, {signOut} from "supertokens-auth-react/recipe/session"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"
import {resetOrganizationData} from "@/oss/state/org"
import {resetProfileData} from "@/oss/state/profile"
import {resetProjectData} from "@/oss/state/project"
import {authFlowAtom, sessionExistsAtom, sessionLoadingAtom} from "@/oss/state/session"
import {clearInvite} from "@/oss/state/url/auth"

// Session existence is global (one per tab), so a module-level guard is correct here: it
// dedupes the auth-loss teardown across useSession's several call sites and fires it only on
// the authed→unauthed edge, not on every logged-out render.
let lastSessionExists: boolean | null = null

// sessionExistsAtom is a re-export of @agenta/shared/state's sessionAtom,
// so a single setter covers both oss and entity-package readers.
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
    const setOnboardingStorageUserId = useSetAtom(onboardingStorageUserIdAtom)
    const router = useRouter()
    const queryClient = useQueryClient()

    useEffect(() => {
        setSessionLoading(res.loading)
        if (!res.loading) {
            const exists = Boolean((res as any).doesSessionExist)
            setSessionExists(exists)
            // Central auth-loss teardown: every sign-out path (not just logout()) funnels
            // through SuperTokens session loss, so clearing persisted PII/secrets from
            // IndexedDB on the authed→unauthed edge here means no per-path clear can be missed.
            if (lastSessionExists === true && !exists) void clearPersistedQueryCache()
            lastSessionExists = exists
            if (authFlow !== "authing") {
                setAuthFlow(exists ? "authed" : "unauthed")
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

    useEffect(() => {
        if (res.loading) return

        const doesSessionExist = Boolean((res as any).doesSessionExist)
        if (!doesSessionExist) {
            setOnboardingStorageUserId(null)
            return
        }

        ;(async () => {
            try {
                const userId = await Session.getUserId()
                setOnboardingStorageUserId(userId)
            } catch {
                // ignore user id lookup failures
            }
        })()
    }, [res.loading, (res as any).doesSessionExist, setOnboardingStorageUserId])

    return {
        loading: res.loading,
        doesSessionExist: (res as any).doesSessionExist,
        logout: async () => {
            try {
                await signOut()
            } catch (error) {
                console.error(error)
            }

            // Clear React Query cache to prevent unauthorized requests. The persisted IDB
            // cache is cleared centrally by the auth-loss effect above (signOut() flips the
            // SuperTokens session, which fires the authed→unauthed edge).
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

            // Forget any stale invite.
            clearInvite()

            // Update session state
            setSessionExists(false)
            setAuthFlow("unauthed")
            setOnboardingStorageUserId(null)

            // Redirect to auth page
            await router.replace("/auth")
        },
    }
}
