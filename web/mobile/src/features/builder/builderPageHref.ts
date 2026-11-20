/**
 * The builder page link of one builder chat, with the agent of the screen in its agent pane
 * (`?tab=agent:<id>`). The builder page (task 27) reads the same link.
 */
export const builderChatHref = ({
    workspaceId,
    projectId,
    chatId,
    agentId,
}: {
    workspaceId: string
    projectId: string
    chatId: string
    agentId?: string | null
}) => {
    const path = `/w/${workspaceId}/p/${projectId}/builder/${encodeURIComponent(chatId)}`
    return agentId ? `${path}?tab=${encodeURIComponent(`agent:${agentId}`)}` : path
}
