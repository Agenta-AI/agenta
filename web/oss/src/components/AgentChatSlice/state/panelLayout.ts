import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/** When true the agent chat/generation panel is maximized: the config panel collapses to 0. */
export const chatPanelMaximizedAtom = atom(false)

/**
 * Whether the agent playground's configuration panel is collapsed via the manual collapse/reveal
 * toggle (the config header's collapse button and the chat header's reveal button) — independent
 * of `chatPanelMaximizedAtom`. Persists across reloads.
 */
export const configPanelCollapsedAtom = atomWithStorage<boolean>(
    "agenta:playground:config-panel-collapsed",
    false,
)
