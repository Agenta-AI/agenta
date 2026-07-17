/**
 * Inspector panel state. The panel is ALWAYS session-scoped (one docked surface, turns grouped in
 * the Timeline); there is no Turn/Session toggle. `focusedTurn` is a lens FOCUS within that one
 * session — it scrolls/highlights the turn and narrows Context to that turn's window, but the
 * chrome never changes. lens/raw/filter/view/width are persisted prefs. URL deep-link is phase 2.
 */
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

export type InspectorLens = "timeline" | "context" | "runtime"
export type TimelineFilter = "all" | "tools" | "interactions"

/** The open target. `null` = collapsed. `focusedTurn` (1-based) narrows the lenses to one turn;
 * null/undefined = the whole session. */
export interface InspectorTarget {
    sessionId: string
    /** 1-based turn index (records are grouped by `done`; no turn_id exists). */
    focusedTurn?: number | null
}

export const inspectorTargetAtom = atom<InspectorTarget | null>(null)

// Chrome prefs — persist across open/close and turn focus.
export const inspectorLensAtom = atomWithStorage<InspectorLens>("agenta:inspector:lens", "timeline")
export const inspectorRawOpenAtom = atomWithStorage<boolean>("agenta:inspector:raw", false)
export const inspectorFilterAtom = atomWithStorage<TimelineFilter>(
    "agenta:inspector:tl-filter",
    "all",
)
export const inspectorWidthAtom = atomWithStorage<number>("agenta:inspector:width", 460)

/** Dock width bounds (build-spec §7). Max is a generous fixed px; a true 60%-of-workspace
 * clamp is phase-2 (needs the container width). */
export const INSPECTOR_MIN_WIDTH = 340
export const INSPECTOR_MAX_WIDTH = 900
export const INSPECTOR_CHAT_FLOOR = 460

/** Open on the whole session (the "Inspect session" trigger). */
export const openInspectorSessionAtom = atom(null, (_get, set, sessionId: string) => {
    if (!sessionId) return
    set(inspectorTargetAtom, {sessionId, focusedTurn: null})
})

/** Open focused on a specific turn (the "Inspect turn" trigger) — scrolls/highlights it. */
export const openInspectorTurnAtom = atom(
    null,
    (_get, set, {sessionId, turn}: {sessionId: string; turn: number}) => {
        if (!sessionId) return
        set(inspectorTargetAtom, {sessionId, focusedTurn: turn})
    },
)

export const closeInspectorAtom = atom(null, (_get, set) => set(inspectorTargetAtom, null))
