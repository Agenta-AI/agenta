import {useCallback} from "react"

import {useRouter} from "next/router"

import {takeReturnPath} from "@/lib/context"
import {queryClient} from "@/lib/queryClient"

/**
 * Where every successful sign-in lands, whatever the route (password, OTP,
 * OIDC): drop the cached unauthenticated verdict, then go back to the page that
 * asked for sign-in, or hand over to the root context resolver.
 */
export function useAuthSuccess() {
    const router = useRouter()
    return useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({queryKey: ["profile"]}),
            queryClient.invalidateQueries({queryKey: ["mobile", "projects"]}),
        ])
        await router.replace(takeReturnPath() || "/")
    }, [router])
}
