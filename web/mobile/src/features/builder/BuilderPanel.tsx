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
 * The Builder content of the right panel (task 8.1): a chat with the builder about the agent of
 * the screen.
 */
export const BuilderPanel = (props: BuilderPanelProps) => {
    // The chat link is per user: read it only once the user is known.
    const userId = useAtomValue(userAtom)?.id
    return userId ? <BuilderChat key={userId} userId={userId} {...props} /> : <ChatLoading />
}
