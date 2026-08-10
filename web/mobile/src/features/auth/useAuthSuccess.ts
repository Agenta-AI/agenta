import {useCallback} from "react"

import {useRouter} from "next/router"

import {queryClient} from "@/lib/queryClient"

/**
 * Where every successful sign-in lands, whatever the route (password, OTP,
 * OIDC): drop the cached unauthenticated verdict so the root context resolver
 * re-fetches, then hand over to it.
 */
export function useAuthSuccess() {
    const router = useRouter()
    return useCallback(async () => {
        await queryClient.invalidateQueries({queryKey: ["mobile", "projects"]})
        await router.replace("/")
    }, [router])
}
