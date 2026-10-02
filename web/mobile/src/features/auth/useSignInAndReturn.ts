import {useCallback} from "react"

import {useRouter} from "next/router"

import {rememberReturnPath} from "@/lib/context"

/** Go to sign-in, and come back to this page after it. */
export const useSignInAndReturn = () => {
    const router = useRouter()
    return useCallback(() => {
        rememberReturnPath(router.asPath)
        void router.push("/auth")
    }, [router])
}
