import {SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH} from "./state"

/** Dragging the rail's edge under this width collapses it to icons. */
export const SIDEBAR_COLLAPSE_SNAP_WIDTH = 160
/** Once collapsing, the pointer has to come back past this to expand again, so a pointer
 * resting on the threshold cannot flicker the rail between the two states. */
export const SIDEBAR_EXPAND_SNAP_WIDTH = 176
/** Past min or max the rail moves at this fraction of the pointer, so the limit reads as
 * resistance instead of a wall. */
const SIDEBAR_RUBBER_BAND = 0.2

export interface SidebarDragIntent {
    kind: "collapse" | "resize"
    width: number
}

const rubberBand = (width: number) => {
    if (width < SIDEBAR_MIN_WIDTH) {
        return SIDEBAR_MIN_WIDTH - (SIDEBAR_MIN_WIDTH - width) * SIDEBAR_RUBBER_BAND
    }
    if (width > SIDEBAR_MAX_WIDTH) {
        return SIDEBAR_MAX_WIDTH + (width - SIDEBAR_MAX_WIDTH) * SIDEBAR_RUBBER_BAND
    }
    return width
}

/** What the rail does for a pointer that would put its edge at `pointerWidth`. */
export const resolveSidebarDragIntent = (
    pointerWidth: number,
    collapsing: boolean,
): SidebarDragIntent => {
    const threshold = collapsing ? SIDEBAR_EXPAND_SNAP_WIDTH : SIDEBAR_COLLAPSE_SNAP_WIDTH
    if (pointerWidth < threshold) {
        // The icon rail still leans after the pointer, so a drag to open is felt before it opens.
        const stretch = Math.max(0, pointerWidth - SIDEBAR_COLLAPSED_WIDTH) * SIDEBAR_RUBBER_BAND
        return {kind: "collapse", width: SIDEBAR_COLLAPSED_WIDTH + stretch}
    }
    return {kind: "resize", width: rubberBand(pointerWidth)}
}

export interface SpringState {
    position: number
    /** px per ms. */
    velocity: number
}

/** One step of a critically damped spring: it keeps the velocity it is handed, so a glide continues
 * the drag's momentum. Closed form, so a dropped frame lands exactly. */
export const stepSpring = (
    state: SpringState,
    target: number,
    elapsedMs: number,
    omegaPerMs: number,
): SpringState => {
    if (omegaPerMs <= 0) return {position: target, velocity: 0}
    const offset = state.position - target
    // Faster than omega * offset towards the target would carry it past; cap it to ease in instead.
    const limit = omegaPerMs * Math.abs(offset)
    const towards = state.velocity * offset < 0
    const handed = towards
        ? Math.sign(state.velocity) * Math.min(Math.abs(state.velocity), limit)
        : state.velocity
    const k = handed + omegaPerMs * offset
    const decay = Math.exp(-omegaPerMs * elapsedMs)
    const position = target + (offset + k * elapsedMs) * decay
    const velocity = (handed - k * omegaPerMs * elapsedMs) * decay
    if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 0.02) {
        return {position: target, velocity: 0}
    }
    return {position, velocity}
}
