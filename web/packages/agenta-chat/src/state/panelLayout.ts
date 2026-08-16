import {atomWithStorage} from "jotai/utils"

import {tabLocalStorage} from "./tabStorage"

/**
 * When true the agent chat panel is maximized: the config panel collapses to 0 and the session
 * rail takes its place. This is the single source of truth for the playground's Build/Chat mode —
 * the header switch writes it, and the layout, the config pane and the chat panel all read it.
 *
 * Persisted, because a refresh is not a request to rearrange the window: someone working in Chat
 * mode was landing back in Build on every reload. The value is global, exactly as it was in memory —
 * the mode belongs to the playground surface, not to a session — so persisting it adds no scope.
 *
 * No `getOnInit`: the desktop server-renders this page, so reading localStorage during atom init
 * would make the server's `false` and the client's stored value disagree and break hydration. The
 * stored value lands in `onMount` instead, one frame in.
 */
export const chatPanelMaximizedAtom = atomWithStorage<boolean>(
    "agenta:agent-chat:panel-maximized",
    false,
    tabLocalStorage<boolean>(),
)
