import {useCallback} from "react"

import {useRouter} from "next/router"

import {signOut} from "@/lib/auth"
import {clearLastContext} from "@/lib/context"
import {queryClient} from "@/lib/queryClient"

/**
 * Sign out and return to `/auth`. Shared by the drawer's logout and by account deletion —
 * after a delete the session is already gone server-side, so a failing `signOut` must not
 * strand the person on a screen whose data no longer exists.
 */
export const useLogout = () => {
    const router = useRouter()

    return useCallback(async () => {
        await signOut().catch(() => undefined)
        clearLastContext()
        await queryClient.invalidateQueries({queryKey: ["mobile", "projects"]})
        void router.replace("/auth")
    }, [router])
}
