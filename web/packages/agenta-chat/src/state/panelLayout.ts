import {atomWithStorage} from "jotai/utils"

/**
 * When true the agent chat panel is maximized: the config panel collapses to 0 and the session
 * rail takes its place. This is the single source of truth for the playground's Build/Chat mode —
 * the header switch writes it, and the layout, the config pane and the chat panel all read it.
 *
 * Persisted: which of the two modes you work in is a standing preference, and resetting it on
 * every reload put chat users back in the build layout they had already left.
 */
export const chatPanelMaximizedAtom = atomWithStorage("agenta:chat:panel-maximized", false)

/** Build mode's config pane collapsed to 0. Separate from the maximize flag: collapsing the pane
 * in Build is not the same as switching to Chat. */
export const configPanelCollapsedAtom = atomWithStorage<boolean>(
    "agenta:chat:config-panel-collapsed",
    false,
)
