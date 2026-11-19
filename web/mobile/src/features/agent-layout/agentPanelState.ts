import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/** What the right panel shows. Only these three. */
export type PanelContent = "files" | "configuration" | "builder"
export type ConfigTab = "agent" | "automations" | "channels" | "access"

/** Stored per user and project. Open views and the 760 px widen are never stored. */
export interface AgentPanelState {
    /** null = closed */
    content: PanelContent | null
    /** Width of Configuration and Builder. Files keeps its own production width. */
    width: number
    configTab: ConfigTab
}

export const PANEL_MIN = 360
export const PANEL_MAX = 640
export const PANEL_DEFAULT = 440
export const PANEL_WIDE = 760
/** Below this window width the panel lies over the conversation instead of pushing it. */
export const OVERLAY_BELOW = 1100
/** Below this window width a panel content opens full screen (the phone path). */
export const PHONE_BELOW = 768

export const DEFAULT_PANEL_STATE: AgentPanelState = {
    content: null,
    width: PANEL_DEFAULT,
    configTab: "agent",
}

const CONTENTS: readonly PanelContent[] = ["files", "configuration", "builder"]
const TABS: readonly ConfigTab[] = ["agent", "automations", "channels", "access"]

export const panelStateKey = (userId: string, projectId: string) =>
    `agenta:agent-panel:${userId}:${projectId}`

export const clampPanelWidth = (width: number) =>
    Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(width)))

/** Reads a stored value; anything malformed falls back field by field. */
export const parsePanelState = (raw: string | null): AgentPanelState => {
    if (!raw) return DEFAULT_PANEL_STATE
    try {
        const value = JSON.parse(raw) as Partial<AgentPanelState>
        return {
            content: CONTENTS.includes(value.content as PanelContent)
                ? (value.content as PanelContent)
                : null,
            width:
                typeof value.width === "number" && Number.isFinite(value.width)
                    ? clampPanelWidth(value.width)
                    : PANEL_DEFAULT,
            configTab: TABS.includes(value.configTab as ConfigTab)
                ? (value.configTab as ConfigTab)
                : "agent",
        }
    } catch {
        return DEFAULT_PANEL_STATE
    }
}

/** Browser storage can be missing or refuse writes (private mode, quota): the panel still works. */
const readStorage = (key: string): string | null => {
    try {
        return typeof window === "undefined" ? null : window.localStorage.getItem(key)
    } catch {
        return null
    }
}
const writeStorage = (key: string, value: AgentPanelState) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // Not stored; the state still holds for this page.
    }
}

/** The panel state of one user in one project. Keyed by the storage key, so users never share it. */
export const agentPanelStateAtomFamily = atomFamily((key: string) => {
    const base = atom<AgentPanelState | null>(null)
    return atom(
        (get) => get(base) ?? parsePanelState(readStorage(key)),
        (get, set, update: Partial<AgentPanelState>) => {
            const next = {...(get(base) ?? parsePanelState(readStorage(key))), ...update}
            next.width = clampPanelWidth(next.width)
            set(base, next)
            writeStorage(key, next)
        },
    )
})

/**
 * The next content after a header icon click: the icon of the open content closes the panel,
 * another icon swaps the content and keeps the panel open.
 */
export const nextPanelContent = (
    open: PanelContent | null,
    clicked: PanelContent,
): PanelContent | null => (open === clicked ? null : clicked)
