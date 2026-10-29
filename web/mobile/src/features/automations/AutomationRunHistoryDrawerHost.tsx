import {useCallback} from "react"

import {AutomationRunHistoryDrawer} from "@agenta/automation-ui"

import {AutomationRunConversation} from "./AutomationRunConversation"

/** The run history drawer with this app's chat surface as its transcript. */
export const AutomationRunHistoryDrawerHost = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const renderConversation = useCallback(
        (sessionId: string, agentId: string | null) => (
            <AutomationRunConversation
                sessionId={sessionId}
                projectId={projectId}
                workspaceId={workspaceId}
                agentId={agentId}
            />
        ),
        [projectId, workspaceId],
    )
    return <AutomationRunHistoryDrawer renderConversation={renderConversation} />
}
