import {atom} from "jotai"

/**
 * When true the agent chat panel is maximized: the config panel collapses to 0 and the session
 * rail takes its place. This is the single source of truth for the playground's Build/Chat mode —
 * the header switch writes it, and the layout, the config pane and the chat panel all read it.
 */
export const chatPanelMaximizedAtom = atom(false)
