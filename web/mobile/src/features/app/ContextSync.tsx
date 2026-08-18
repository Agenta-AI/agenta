import {useEffect} from "react"

import {setProjectIdAtom} from "@agenta/shared/state"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {writeLastContext} from "@/lib/context"

/** Null-rendering: mirrors route params into the shared state @agenta/entities reads. */
export const ContextSync = () => {
    const router = useRouter()
    const setProjectId = useSetAtom(setProjectIdAtom)

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
