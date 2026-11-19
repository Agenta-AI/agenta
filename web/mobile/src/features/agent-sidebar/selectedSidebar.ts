import {useSyncExternalStore} from "react"

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
export const SELECTED_SIDEBAR_KEY = "agenta:sidebar"

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

const serialize = (sidebar: SelectedSidebar): string | null =>
    sidebar.kind === "main" ? null : JSON.stringify(sidebar)

const listeners = new Set<() => void>()
let cachedRaw: string | null | undefined
let cached: SelectedSidebar = MAIN_SIDEBAR

const readRaw = (): string | null => {
    try {
        return window.sessionStorage.getItem(SELECTED_SIDEBAR_KEY)
    } catch {
        return null
    }
}

const snapshot = (): SelectedSidebar => {
    const raw = readRaw()
    // One object per stored value, so `useSyncExternalStore` sees a stable snapshot.
    if (raw !== cachedRaw) {
        cachedRaw = raw
        cached = parseSelectedSidebar(raw)
    }
    return cached
}

export const setSelectedSidebar = (sidebar: SelectedSidebar) => {
    const raw = serialize(sidebar)
    try {
        if (raw) window.sessionStorage.setItem(SELECTED_SIDEBAR_KEY, raw)
        else window.sessionStorage.removeItem(SELECTED_SIDEBAR_KEY)
    } catch {
        // Storage refused: the sidebar does not change.
    }
    listeners.forEach((listener) => listener())
}

/** Show the agent sidebar of `agentId`. "Back" returns to `from`. */
export const openAgentSidebar = (agentId: string, from: AgentSidebarOrigin = "main") =>
    setSelectedSidebar({kind: "agent", agentId, from})

export const showMainSidebar = () => setSelectedSidebar(MAIN_SIDEBAR)

const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

const serverSnapshot = () => MAIN_SIDEBAR

export const useSelectedSidebar = (): SelectedSidebar =>
    useSyncExternalStore(subscribe, snapshot, serverSnapshot)
