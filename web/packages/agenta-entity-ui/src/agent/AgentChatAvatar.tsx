import type {ReactNode} from "react"

import {ChatBubbleAvatar} from "@agenta/ui/components/presentational"

import {useAgentIconChrome} from "./agentIcon"

export interface AgentChatAvatarProps {
    /** The agent's workflow id. Null for a user turn, a draft agent, or an unresolved session. */
    workflowId?: string | null
    /** Drawn when nobody picked an icon — each host's own glyph, so a default turn is unchanged. */
    fallback: ReactNode
    size?: number
}

/**
 * A chat turn's avatar: the agent's chosen mark, or the host's own fallback inside the shared
 * bubble avatar.
 *
 * Shared because both transcripts had copied the same customised/fallback branch and the same
 * 24px chip around the same `ChatBubbleAvatar`; only the fallback glyph differs (the desktop is
 * on Phosphor, mobile on lucide), so that arrives as a prop.
 */
export const AgentChatAvatar = ({workflowId, fallback, size = 16}: AgentChatAvatarProps) => {
    const chrome = useAgentIconChrome(workflowId, {size, fallbackGlyph: null})

    if (!chrome.customised) return <ChatBubbleAvatar icon={fallback} />

    // `size-6` is the ChatBubbleAvatar box, so a custom mark lines up with an uncustomised one.
    return (
        <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full ${chrome.className}`}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}
