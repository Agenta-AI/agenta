import {memo} from "react"

import {userAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {ChatLoading} from "../chat/states/ChatStates"

import {BuilderChat} from "./BuilderChat"

export interface BuilderPanelProps {
    /** The agent of the screen. The builder chat is about this agent. */
    agentId: string
    workspaceId: string
    projectId: string
}

/**
 * The Builder content of the right panel: a chat with the builder about the agent of the screen.
 * Memoized: the agent layout renders again on every session switch, and a switch to another
 * session of the same agent must render nothing in the builder but the context chip.
 */
export const BuilderPanel = memo(function BuilderPanel(props: BuilderPanelProps) {
    // The chat link is per user: read it only once the user is known.
    const userId = useAtomValue(userAtom)?.id
    // Per user and agent: the chat link is per user, and another agent runs the open rule again.
    return userId ? (
        <BuilderChat key={`${userId}:${props.agentId}`} userId={userId} {...props} />
    ) : (
        <ChatLoading />
    )
})
