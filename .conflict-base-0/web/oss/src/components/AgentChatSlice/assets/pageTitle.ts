import {
    SESSION_TITLE_MAX_LENGTH,
    normalizeTitlePart,
    truncateTitlePart,
} from "@/oss/components/PageTitle/utils"

interface AgentChatTitleInput {
    agentName?: string | null
    sessionTitle?: string | null
    firstUserMessage?: string | null
}

export const selectAgentChatTitlePart = ({
    agentName,
    sessionTitle,
    firstUserMessage,
}: AgentChatTitleInput): string => {
    const startedTitle = normalizeTitlePart(sessionTitle) || normalizeTitlePart(firstUserMessage)
    if (startedTitle) return truncateTitlePart(startedTitle, SESSION_TITLE_MAX_LENGTH)
    return normalizeTitlePart(agentName)
}
