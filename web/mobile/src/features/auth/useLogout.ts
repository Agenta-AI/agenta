import {useCallback} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"
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
    const setActiveUserId = useSetAtom(activeUserIdAtom)

    return useCallback(async () => {
        await signOut().catch(() => undefined)
        clearLastContext()
        // The unambiguous end of a session. Per-user preferences are scoped by the active user
        // id, so it goes with the session — otherwise the next person to sign in on this
        // browser reads the previous one's settings until the profile query catches up. The
        // cached profile is that session's identity too: drop it, or the stale answer would put
        // the id straight back.
        setActiveUserId(null)
        queryClient.removeQueries({queryKey: ["profile"]})
        await queryClient.invalidateQueries({queryKey: ["mobile", "projects"]})
        void router.replace("/auth")
    }, [router, setActiveUserId])
}
