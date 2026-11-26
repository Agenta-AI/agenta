import {createContext, useContext} from "react"

/**
 * The conversation is the builder's own chat. Its answers carry the "Builder" author line (S03,
 * M05), and its change cards offer no "Always auto-approve": the grant would go to the builder,
 * not to the agent it edits (OPEN-QUESTIONS 2.67).
 */
export const BuilderChatContext = createContext(false)

export const useIsBuilderChat = (): boolean => useContext(BuilderChatContext)
