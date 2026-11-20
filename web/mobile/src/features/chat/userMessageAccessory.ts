import {createContext, type ReactNode} from "react"

/**
 * What a host shows with a sent user message, read by message id from the message as stored (the
 * builder chat shows the context chip the message was sent with). Null: nothing.
 */
export const UserMessageAccessoryContext = createContext<((messageId: string) => ReactNode) | null>(
    null,
)
