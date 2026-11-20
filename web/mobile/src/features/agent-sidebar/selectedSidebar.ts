import {getDefaultStore, useAtomValue} from "jotai"
import {atomWithStorage} from "jotai/utils"

/**
 * Which sidebar this browser tab shows: the main one, or the agent sidebar of one agent. It is
 * its own state, not the route: the agent sidebar stays while the person opens a session, the
 * Configuration page or another page of that agent.
 *
 * Kept in sessionStorage, so it lasts for the tab and its reloads, and a link opened in a new tab
 * starts on the main sidebar. `from` is where "Back" returns: the main sidebar, or the Agents list.
 */
export type SelectedSidebar =
    | {kind: "main"}
    | {kind: "agent"; agentId: string; from: AgentSidebarOrigin}

export type AgentSidebarOrigin = "main" | "agents"

export const MAIN_SIDEBAR: SelectedSidebar = {kind: "main"}

/** sessionStorage key. */
export const SELECTED_SIDEBAR_KEY = "agenta:nav:selectedSidebar"

/** The stored value, or the main sidebar when it names nothing valid. */
export const parseSelectedSidebar = (raw: string | null): SelectedSidebar => {
    if (!raw) return MAIN_SIDEBAR
    try {
        const value = JSON.parse(raw) as {kind?: unknown; agentId?: unknown; from?: unknown}
        if (value?.kind === "agent" && typeof value.agentId === "string" && value.agentId) {
            return {
                kind: "agent",
                agentId: value.agentId,
                from: value.from === "agents" ? "agents" : "main",
            }
        }
    } catch {
        // Not JSON: the main sidebar.
    }
    return MAIN_SIDEBAR
}

/** sessionStorage, read through the parser. A refused write keeps the choice in memory only. */
const tabStorage = {
    getItem: (key: string): SelectedSidebar => {
        try {
            return parseSelectedSidebar(window.sessionStorage.getItem(key))
        } catch {
            return MAIN_SIDEBAR
        }
    },
    setItem: (key: string, value: SelectedSidebar) => {
        try {
            if (value.kind === "main") window.sessionStorage.removeItem(key)
            else window.sessionStorage.setItem(key, JSON.stringify(value))
        } catch {
            // Storage refused: the choice does not survive a reload.
        }
    },
    removeItem: (key: string) => {
        try {
            window.sessionStorage.removeItem(key)
        } catch {
            // Storage refused.
        }
    },
}

export const selectedSidebarAtom = atomWithStorage<SelectedSidebar>(
    SELECTED_SIDEBAR_KEY,
    MAIN_SIDEBAR,
    tabStorage,
)

export const setSelectedSidebar = (sidebar: SelectedSidebar) =>
    getDefaultStore().set(selectedSidebarAtom, sidebar)

/** The choice now, outside React: a pending action checks it is still the one it made. */
export const currentSidebar = (): SelectedSidebar => getDefaultStore().get(selectedSidebarAtom)

/** Show the agent sidebar of `agentId`. "Back" returns to `from`. Returns the new choice. */
export const openAgentSidebar = (
    agentId: string,
    from: AgentSidebarOrigin = "main",
): SelectedSidebar => {
    const sidebar: SelectedSidebar = {kind: "agent", agentId, from}
    setSelectedSidebar(sidebar)
    return sidebar
}

export const openMainSidebar = () => setSelectedSidebar(MAIN_SIDEBAR)

export const useSelectedSidebar = (): SelectedSidebar => useAtomValue(selectedSidebarAtom)
