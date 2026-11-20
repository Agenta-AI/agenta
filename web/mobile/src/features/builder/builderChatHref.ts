/**
 * The builder page link of one builder chat, with the agent of the screen in its agent pane
 * (`?tab=agent:<id>`). The builder page (task 27) reads the same link.
 */
export const builderChatHref = ({
    workspaceId,
    projectId,
    sessionId,
    agentId,
}: {
    workspaceId: string
    projectId: string
    sessionId: string
    agentId?: string | null
}) => {
    const path = `/w/${workspaceId}/p/${projectId}/builder/${encodeURIComponent(sessionId)}`
    return agentId ? `${path}?tab=${encodeURIComponent(`agent:${agentId}`)}` : path
}
