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
    useEffect(() => {
        if (user?.id) setActiveUserId(user.id)
    }, [user?.id, setActiveUserId])

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
