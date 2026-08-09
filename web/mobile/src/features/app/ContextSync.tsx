import {useEffect} from "react"

import {useProfile} from "@agenta/entities/profile"
import {activeUserIdAtom, setProjectIdAtom, setUserAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {writeLastContext} from "@/lib/context"

/** Null-rendering: mirrors route params into the shared state @agenta/entities reads. */
export const ContextSync = () => {
    const router = useRouter()
    const setProjectId = useSetAtom(setProjectIdAtom)
    const setActiveUserId = useSetAtom(activeUserIdAtom)
    const setSharedUser = useSetAtom(setUserAtom)
    const {user} = useProfile()

    // The identity half of the app context, and this app's answer to the desktop's
    // `UserListener`. Entity queries scoped by user gate on it — the vault's secrets key is
    // `["vault", "secrets", user?.id, projectId]` with `enabled: !!user` — so without this the
    // Secrets and LLMs tabs sat on their skeletons forever, waiting on a query never enabled.
    useEffect(() => {
        setSharedUser(user)
    }, [user, setSharedUser])

    // Per-user preferences (the Experiments switches) are scoped by this id, and they are read
    // far from Settings — the chat composer asks whether voice is on. Written only once the
    // profile answers: clearing it on a signed-out render would hand the next person on this
    // browser a blank slate instead of their own settings.
    //
    // A *falsy* profile is not the same thing as a *finished* one. `user` is null while the
    // query is still in flight (the id is storage-backed precisely so preferences resolve
    // before that lands) and null when the request failed. Only a settled answer — no longer
    // pending, no error, still null — is the 401 that means this session is over, and then the
    // scope has to go: leaving it set would scope the next person on this browser to the
    // previous one's preferences. Clearing drops only the pointer; each user's flags stay under
    // their own `agenta:settings:<id>:*` keys and come back when they sign in again.
    useEffect(() => {
        if (user?.id) setActiveUserId(user.id)
        else if (!isPending && !error) setActiveUserId(null)
    }, [user?.id, isPending, error, setActiveUserId])

    const {workspace_id, project_id} = router.query
    const workspaceId = typeof workspace_id === "string" ? workspace_id : null
    const projectId = typeof project_id === "string" ? project_id : null

    useEffect(() => {
        if (!router.isReady) return
        setProjectId(projectId)
    }, [router.isReady, projectId, setProjectId])

    useEffect(() => {
        if (workspaceId && projectId) {
            writeLastContext({workspaceId, projectId})
        }
    }, [workspaceId, projectId])

    return null
}
