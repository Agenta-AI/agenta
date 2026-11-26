import type {ReactNode} from "react"

import {CONVERSATION_ROLE_ATTR} from "./conversationFocus"
import {useConversationRole} from "./conversationRole"

/**
 * The element that tells which conversation holds the focus: it carries the role the container
 * gave. `contents` adds no box, so the conversation keeps its place in the parent's layout.
 */
export const ConversationRoot = ({children}: {children: ReactNode}) => {
    const role = useConversationRole()
    return (
        <div {...{[CONVERSATION_ROLE_ATTR]: role}} className="contents">
            {children}
        </div>
    )
}
