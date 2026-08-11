import {atomWithStorage} from "jotai/utils"

/**
 * Dock geometry for the chat's right split (RightPanelSplit) — now hosting the Inspector. The
 * Inspector's open/scope/lens live in `components/Inspector/state.ts`; this file only owns the
 * persisted width + clamp bounds shared by the splitter.
 */
export const rightPanelWidthAtom = atomWithStorage<number>(
    "agenta:agent-chat:right-panel-width",
    460,
)

/** Panel min width (keeps tool-I/O JSON readable) and the chat floor it must never squeeze below. */
export const RIGHT_PANEL_MIN = 360
export const RIGHT_PANEL_MAX = 900
export const CHAT_MIN = 460

/** The Files pane (the drawer-turned-pane) shares RightPanelSplit but keeps its own persisted
 * width + bounds — two-pane tree + preview needs more room than the Inspector, and the max stays
 * generous so it can be dragged near-drawer-wide (the chat floor still caps it on small screens). */
export const filesPaneWidthAtom = atomWithStorage<number>("agenta:agent-chat:files-pane-width", 620)
export const FILES_PANE_MIN = 420
export const FILES_PANE_MAX = 1600
