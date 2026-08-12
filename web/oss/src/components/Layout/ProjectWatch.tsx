import {useCallback, useMemo} from "react"

import {invalidateSessionListQueries} from "@agenta/entities/session"
import {queryClient} from "@agenta/shared/api"

import {invalidateAgentsWorkflowQueries} from "@/oss/components/pages/agents/store"
import {useProjectWatch, type ProjectWatchHandlers} from "@/oss/hooks/useProjectWatch"

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
        invalidateSessionListQueries()
        void invalidateAgentsWorkflowQueries()
        void queryClient.invalidateQueries({
            queryKey: ["workflows", "artifact"],
            exact: false,
        })
    }, [])

    const handlers = useMemo(
        (): ProjectWatchHandlers => ({
            ready: revalidateProjectLists,
            "session-changed": invalidateSessionListQueries,
            "workflow-changed": invalidateWorkflow,
        }),
        [invalidateWorkflow, revalidateProjectLists],
    )

    useProjectWatch({on: handlers})
    return null
}

export default ProjectWatch
