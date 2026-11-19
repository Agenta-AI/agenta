import {createContext, useContext} from "react"

/**
 * Where a conversation sits on the screen. The session's own conversation is the "page" one; the
 * builder chat in the right panel is "embedded". The container gives the role as a context value,
 * never as a key or a branch, so a role change keeps the same conversation mounted with its state.
 */
export type ConversationRole = "page" | "embedded"

export const ConversationRoleContext = createContext<ConversationRole>("page")

export const useConversationRole = (): ConversationRole => useContext(ConversationRoleContext)
