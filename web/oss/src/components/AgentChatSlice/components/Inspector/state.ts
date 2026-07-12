/**
 * Inspector panel state (build-spec §2). Scope + target are ephemeral (the open target); lens,
 * raw, filter, density, width are persisted chrome prefs that survive open/close and scope
 * switches. Phase 1 persists to localStorage; URL deep-link (scope + target) is phase 2.
 */
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

export type InspectorScope = "turn" | "session"
export type InspectorLens = "timeline" | "context" | "runtime"
export type TimelineFilter = "all" | "tools" | "interactions"
export type TimelineDensity = "readable" | "indexed"

/** The open target. `null` = collapsed. `targetTurn` (1-based) set only in turn scope. */
export interface InspectorTarget {
    sessionId: string
    scope: InspectorScope
    /** 1-based turn index (records are grouped by `done`; no turn_id exists). */
    targetTurn?: number | null
}

export const inspectorTargetAtom = atom<InspectorTarget | null>(null)

// Chrome prefs — persist across open/close and scope switches (build-spec §2/§3).
export const inspectorLensAtom = atomWithStorage<InspectorLens>("agenta:inspector:lens", "timeline")
export const inspectorRawOpenAtom = atomWithStorage<boolean>("agenta:inspector:raw", false)
export const inspectorFilterAtom = atomWithStorage<TimelineFilter>(
    "agenta:inspector:tl-filter",
    "all",
)
export const inspectorDensityAtom = atomWithStorage<TimelineDensity>(
    "agenta:inspector:tl-density",
    "readable",
)
export const inspectorWidthAtom = atomWithStorage<number>("agenta:inspector:width", 460)

/** Dock width bounds (build-spec §7). Max is a generous fixed px; a true 60%-of-workspace
 * clamp is phase-2 (needs the container width). */
export const INSPECTOR_MIN_WIDTH = 340
export const INSPECTOR_MAX_WIDTH = 900
export const INSPECTOR_CHAT_FLOOR = 460

/** Open at session scope (the "Inspect session" trigger). */
export const openInspectorSessionAtom = atom(null, (_get, set, sessionId: string) => {
    if (!sessionId) return
    set(inspectorTargetAtom, {sessionId, scope: "session"})
})

/** Open at turn scope on a specific turn (the "Inspect turn" trigger). */
export const openInspectorTurnAtom = atom(
    null,
    (_get, set, {sessionId, turn}: {sessionId: string; turn: number}) => {
        if (!sessionId) return
        set(inspectorTargetAtom, {sessionId, scope: "turn", targetTurn: turn})
    },
)

export const closeInspectorAtom = atom(null, (_get, set) => set(inspectorTargetAtom, null))
