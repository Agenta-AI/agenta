import {useEffect} from "react"

import {useProfile} from "@agenta/entities/profile"
import {activeUserIdAtom, setProjectIdAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {writeLastContext} from "@/lib/context"

/** Null-rendering: mirrors route params into the shared state @agenta/entities reads. */
export const ContextSync = () => {
    const router = useRouter()
    const setProjectId = useSetAtom(setProjectIdAtom)
    const setActiveUserId = useSetAtom(activeUserIdAtom)
    const {user} = useProfile()

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
