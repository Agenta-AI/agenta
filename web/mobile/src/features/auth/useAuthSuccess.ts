import {useCallback} from "react"

import {fetchProfile} from "@agenta/entities/profile"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {postAuthBootAtom} from "@/features/app/postAuthBoot"
import {markOnboardingPending} from "@/features/onboarding/onboardingPending"
import {writeLastAuthEmail, writeLastAuthMethod} from "@/lib/auth"
import {isOnboardingFlowEnabled} from "@/lib/env"
import {queryClient} from "@/lib/queryClient"

export interface AuthSuccess {
    /** "email" for password and one-time code, else the OIDC provider id. */
    method: string
    /** The address an email method signed in with. */
    email?: string
    /** SuperTokens' `createdNewRecipeUser`; account linking is off, so it means a new login. */
    isNewUser: boolean
}

/** A new account owes onboarding; the mark is keyed by the Agenta user id the app reads later. */
const markNewAccount = async () => {
    const user = await queryClient
        .fetchQuery({queryKey: ["profile"], queryFn: fetchProfile})
        .catch(() => null)
    if (user) markOnboardingPending(user.id)
}

/** Every successful sign-in: remember the method, raise the loader, refetch, go home. */
export function useAuthSuccess() {
    const router = useRouter()
    const startBoot = useSetAtom(postAuthBootAtom)
    return useCallback(
        async ({method, email, isNewUser}: AuthSuccess) => {
            writeLastAuthMethod(method)
            if (method === "email" && email) writeLastAuthEmail(email)
            startBoot({account: isNewUser ? "new" : "returning", startedAt: Date.now()})
            try {
                await Promise.all([
                    queryClient.invalidateQueries({queryKey: ["profile"]}),
                    queryClient.invalidateQueries({queryKey: ["mobile", "projects"]}),
                ])
                if (isNewUser && isOnboardingFlowEnabled()) await markNewAccount()
                await router.replace("/")
            } catch (error) {
                startBoot(null)
                throw error
            }
        },
        [router, startBoot],
    )
}
