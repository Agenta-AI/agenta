import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/**
 * The single right-side panel next to the chat. It adapts to context: a `turn` view (the build-mode
 * turn inspector) or a `session` view (session-scoped content — mounts, and later state/records/
 * interactions). One panel, one slot — opening one mode replaces the other. `null` = collapsed.
 */
export type SessionPanelTab = "mounts" | "state" | "records" | "interactions"

export type RightPanelTarget =
    | {mode: "turn"; sessionId: string; assistantMessageId: string}
    | {mode: "session"; sessionId: string; tab?: SessionPanelTab}

export const rightPanelAtom = atom<RightPanelTarget | null>(null)

/** Persisted panel width in px. Clamped to the panel min and a chat-floor cap at drag time. */
export const rightPanelWidthAtom = atomWithStorage<number>(
    "agenta:agent-chat:right-panel-width",
    420,
)

/** Panel min width (keeps tool-I/O JSON readable) and the chat floor it must never squeeze below. */
export const RIGHT_PANEL_MIN = 360
export const RIGHT_PANEL_MAX = 680
export const CHAT_MIN = 480
