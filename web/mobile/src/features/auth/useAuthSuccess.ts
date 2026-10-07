import {useCallback} from "react"

import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {postAuthBootAtom} from "@/features/app/postAuthBoot"
import {writeLastAuthEmail, writeLastAuthMethod} from "@/lib/auth"
import {queryClient} from "@/lib/queryClient"

export interface AuthSuccess {
    /** "email" for password and one-time code, else the OIDC provider id. */
    method: string
    /** The address an email method signed in with. */
    email?: string
    isNewUser: boolean
}

/**
 * Where every successful sign-in lands, whatever the route (password, OTP, OIDC): remember the
 * method for the next visit, raise the post-auth loader, drop the cached unauthenticated verdict
 * so the root context resolver re-fetches, then hand over to it.
 */
export function useAuthSuccess() {
    const router = useRouter()
    const startBoot = useSetAtom(postAuthBootAtom)
    return useCallback(
        async ({method, email, isNewUser}: AuthSuccess) => {
            writeLastAuthMethod(method)
            if (method === "email" && email) writeLastAuthEmail(email)
            startBoot({account: isNewUser ? "new" : "returning", startedAt: Date.now()})
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ["profile"]}),
                queryClient.invalidateQueries({queryKey: ["mobile", "projects"]}),
            ])
            await router.replace("/")
        },
        [router, startBoot],
    )
}
