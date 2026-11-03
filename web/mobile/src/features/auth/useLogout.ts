import {useCallback} from "react"

import {projectPermissionQueryPrefix} from "@agenta/entities/access"
import {clearPersistedQueryCache} from "@agenta/shared/api/persist"
import {useRouter} from "next/router"

import {resetAnalytics} from "@/features/analytics/client"
import {clearTranscriptSnapshots} from "@/features/chat/useSessionTranscript"
import {signOut} from "@/lib/auth"
import {clearLastContext, type ProjectsResult} from "@/lib/context"
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
        await resetAnalytics()
        clearLastContext()
        clearTranscriptSnapshots()
        // Permission answers belong to the person who signed out: the next person in this tab
        // must be asked again before any gated read (traces included) opens.
        queryClient.removeQueries({queryKey: projectPermissionQueryPrefix})
        // AuthGate reads this verdict on `/auth`; a cached "ok" would send the user back to `/`.
        queryClient.setQueryData<ProjectsResult>(["mobile", "projects"], {kind: "unauthenticated"})
        // Leave the data screens first, so clearing the cache does not refetch under them.
        await router.replace("/auth")
        await queryClient.cancelQueries()
        queryClient.clear()
        await clearPersistedQueryCache()
    }, [router])
}
