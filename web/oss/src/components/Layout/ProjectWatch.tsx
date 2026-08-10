import {useCallback, useMemo} from "react"

import {queryClient} from "@agenta/shared/api"
import {useAtomValue} from "jotai"

import {invalidateAgentsWorkflowQueries} from "@/oss/components/pages/agents/store"
import {useProjectWatch, type ProjectWatchHandlers} from "@/oss/hooks/useProjectWatch"
import {projectIdAtom} from "@/oss/state/project"

const workflowIdFromEvent = (event: MessageEvent<string>): string | null => {
    try {
        const payload: unknown = JSON.parse(event.data)
        if (!payload || typeof payload !== "object" || !("id" in payload)) return null
        return typeof payload.id === "string" ? payload.id : null
    } catch {
        return null
    }
}

const ProjectWatch = () => {
    const projectId = useAtomValue(projectIdAtom)

    const invalidateSessions = useCallback(() => {
        if (!projectId) return
        void queryClient.invalidateQueries({
            queryKey: ["session-list", projectId],
            exact: false,
        })
    }, [projectId])

    const invalidateWorkflow = useCallback((event: MessageEvent<string>) => {
        void invalidateAgentsWorkflowQueries()
        const workflowId = workflowIdFromEvent(event)
        if (!workflowId) return
        void queryClient.invalidateQueries({
            queryKey: ["workflows", "artifact", workflowId],
            exact: false,
        })
    }, [])

    const revalidateProjectLists = useCallback(() => {
        invalidateSessions()
        void invalidateAgentsWorkflowQueries()
        void queryClient.invalidateQueries({
            queryKey: ["workflows", "artifact"],
            exact: false,
        })
    }, [invalidateSessions])

    const handlers = useMemo(
        (): ProjectWatchHandlers => ({
            ready: revalidateProjectLists,
            "session-changed": invalidateSessions,
            "workflow-changed": invalidateWorkflow,
        }),
        [invalidateSessions, invalidateWorkflow, revalidateProjectLists],
    )

    useProjectWatch({on: handlers})
    return null
}

export default ProjectWatch
