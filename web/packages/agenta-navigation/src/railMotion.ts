import {resolveSidebarDragIntent, stepSpring} from "./sidebarDrag"
import {clampSidebarWidth, SIDEBAR_COLLAPSED_WIDTH} from "./state"

/** Stiffness of the width glide; it settles in about 350ms. */
const GLIDE_OMEGA_PER_MS = 0.02
/** A drag faster than this (px/ms) does not fling the glide any harder. */
const MAX_HANDOFF_VELOCITY = 1.5
/** Momentum older than this is stale; the pointer had stopped. */
const MOMENTUM_WINDOW_MS = 80
/** The collapse commits (one heavy React render) once the glide is this close to its target. */
const COMMIT_DISTANCE = 4
/** A frame stalled by a React commit continues the glide instead of skipping ahead. */
const MAX_FRAME_MS = 32
const FADE_OUT_MS = 120
const FADE_IN_MS = 180
const FADE_EASING = "cubic-bezier(0.23, 1, 0.32, 1)"

/** The parts of a pointer event the controller reads. */
export interface RailPointerEvent {
    pointerId: number
    clientX: number
    button: number
    preventDefault: () => void
    currentTarget: Pick<
        Element,
        "setPointerCapture" | "hasPointerCapture" | "releasePointerCapture"
    >
}

interface Gesture {
    pointerId: number
    startX: number
    startWidth: number
    pointerWidth: number
}

/** `out`: expanded content fading, collapse not committed. `in`: collapsed, icons on screen. */
type Snap = "none" | "out" | "in"

interface Motion {
    gesture: Gesture | null
    snap: Snap
    fadedOut: boolean
    /** The collapsed state this motion has asked React for. */
    collapsed: boolean
    /** The width painted on the rail. */
    current: number
    /** px per ms, measured while tracking and carried into a glide. */
    velocity: number
    velocityAt: number
    target: number
    /** True while `current` springs towards `target`; false tracks the pointer 1:1. */
    gliding: boolean
    frame: number | null
    lastTime: number | null
    fade: Animation | null
    reducedMotion: boolean
}

export interface RailMotionDeps {
    rail: () => HTMLElement | null
    content: () => HTMLElement | null
    /** The stored width React renders while expanded. */
    readWidth: () => number
    /** The collapsed state React last rendered. */
    isCollapsed: () => boolean
    setCollapsed: (collapsed: boolean) => void
    setWidth: (width: number) => void
    prefersReducedMotion: () => boolean
}

const clampVelocity = (velocity: number) =>
    Math.max(-MAX_HANDOFF_VELOCITY, Math.min(MAX_HANDOFF_VELOCITY, velocity))

/**
 * The rail's drag: resize, drag to collapse, drag to open. Width is painted onto the rail's
 * `--ag-sidebar-w` from one rAF loop; React hears only `setCollapsed` and `setWidth`.
 */
export const createRailMotion = (deps: RailMotionDeps) => {
    let motion: Motion | null = null
    /** A collapsed state asked of React that it has not rendered yet. */
    let pendingCollapsed: boolean | null = null

    const knownCollapsed = () => pendingCollapsed ?? deps.isCollapsed()

    const paint = (value: number) => {
        deps.rail()?.style.setProperty("--ag-sidebar-w", `${value}px`)
    }

    const requestCollapsed = (m: Motion, collapsed: boolean) => {
        m.collapsed = collapsed
        pendingCollapsed = collapsed
        deps.setCollapsed(collapsed)
    }

    const setSnap = (m: Motion, snap: Snap, pinnedWidth?: number) => {
        m.snap = snap
        const rail = deps.rail()
        if (!rail) return
        if (snap === "none") {
            rail.removeAttribute("data-snap")
            rail.style.removeProperty("--ag-snap-w")
            return
        }
        rail.setAttribute("data-snap", snap)
        if (pinnedWidth !== undefined) rail.style.setProperty("--ag-snap-w", `${pinnedWidth}px`)
    }

    const fadeContent = (m: Motion, to: 0 | 1, duration: number, fromZero = false) => {
        const content = deps.content()
        if (!content || typeof content.animate !== "function") return null
        // Read before cancelling, so a reversal starts from where the last fade had got to.
        const from = fromZero ? 0 : Number(getComputedStyle(content).opacity)
        m.fade?.cancel()
        m.fade = content.animate([{opacity: from}, {opacity: to}], {
            duration: m.reducedMotion ? 0 : duration,
            easing: FADE_EASING,
            fill: "forwards",
        })
        return m.fade
    }

    /** Hides the content until React has swapped it; `sync` fades the new content in. */
    const swapContent = (m: Motion, collapsed: boolean) => {
        fadeContent(m, 0, 0)
        requestCollapsed(m, collapsed)
    }

    const finish = (m: Motion) => {
        if (m.frame !== null) cancelAnimationFrame(m.frame)
        motion = null
        const rail = deps.rail()
        // Flush the last painted width first, or re-enabled transitions animate the final step.
        void rail?.offsetWidth
        rail?.removeAttribute("data-resizing")
        setSnap(m, "none")
        const fade = m.fade
        if (fade) fade.finished.then(() => fade.cancel()).catch(() => undefined)
    }

    const settleIfDone = (m: Motion) => {
        if (m.gliding || m.frame !== null || m.gesture || m.snap === "out") return
        // React has not rendered the swap yet; `sync` settles once it has.
        if (pendingCollapsed !== null) return
        finish(m)
    }

    const commitCollapseIfReady = (m: Motion) => {
        if (motion !== m || m.snap !== "out" || !m.fadedOut) return
        if (Math.abs(m.current - m.target) > COMMIT_DISTANCE) return
        setSnap(m, "in", SIDEBAR_COLLAPSED_WIDTH)
        requestCollapsed(m, true)
    }

    const tick = (time: number) => {
        const m = motion
        if (!m) return
        m.frame = null
        const elapsed = m.lastTime === null ? 16 : Math.max(0, time - m.lastTime)
        m.lastTime = time

        if (m.gliding) {
            const next = stepSpring(
                {position: m.current, velocity: m.velocity},
                m.target,
                Math.min(MAX_FRAME_MS, elapsed),
                m.reducedMotion ? 0 : GLIDE_OMEGA_PER_MS,
            )
            m.current = next.position
            m.velocity = next.velocity
        } else {
            m.velocity = (m.velocity + (m.target - m.current) / Math.max(elapsed, 1)) / 2
            m.velocityAt = time
            m.current = m.target
        }
        paint(m.current)
        commitCollapseIfReady(m)

        if (m.current !== m.target) {
            m.frame = requestAnimationFrame(tick)
            return
        }
        if (m.gliding) {
            m.gliding = false
            m.lastTime = null
        }
        settleIfDone(m)
    }

    const schedule = (m: Motion) => {
        if (m.frame === null) m.frame = requestAnimationFrame(tick)
    }

    const startGlide = (m: Motion) => {
        if (!m.gliding) {
            const fresh = performance.now() - m.velocityAt < MOMENTUM_WINDOW_MS
            m.velocity = fresh ? clampVelocity(m.velocity) : 0
            m.lastTime = null
        }
        m.gliding = true
        schedule(m)
    }

    const startCollapse = (m: Motion, width: number) => {
        if (m.reducedMotion) {
            m.current = m.target = width
            paint(m.current)
            setSnap(m, "in", SIDEBAR_COLLAPSED_WIDTH)
            swapContent(m, true)
            return
        }
        // Pin the content at its current width so the narrowing rail clips it, never reflows it.
        setSnap(m, "out", m.current)
        m.fadedOut = false
        m.target = width
        startGlide(m)
        const fade = fadeContent(m, 0, FADE_OUT_MS)
        const onFadedOut = () => {
            if (m.fade !== fade) return
            m.fadedOut = true
            commitCollapseIfReady(m)
        }
        if (fade) fade.finished.then(onFadedOut).catch(() => undefined)
        else onFadedOut()
    }

    const cancelCollapse = (m: Motion, nextWidth: number) => {
        const committed = m.snap === "in"
        setSnap(m, "none")
        if (committed) swapContent(m, false)
        else fadeContent(m, 1, FADE_IN_MS)
        m.target = nextWidth
        startGlide(m)
    }

    const pointerDown = (event: RailPointerEvent) => {
        if (event.button !== 0 || motion?.gesture || motion?.snap === "out") return
        if (pendingCollapsed !== null) return

        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const collapsed = knownCollapsed()
        // Grabbing a rail that is still settling picks it up where it is.
        const startWidth = motion
            ? motion.current
            : collapsed
              ? SIDEBAR_COLLAPSED_WIDTH
              : deps.readWidth()
        const m: Motion = motion ?? {
            gesture: null,
            snap: "none",
            fadedOut: false,
            collapsed,
            current: startWidth,
            velocity: 0,
            velocityAt: 0,
            target: startWidth,
            gliding: false,
            frame: null,
            lastTime: null,
            fade: null,
            reducedMotion: false,
        }
        m.reducedMotion = deps.prefersReducedMotion()
        if (collapsed && m.snap === "none") setSnap(m, "in", SIDEBAR_COLLAPSED_WIDTH)
        m.gesture = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth,
            pointerWidth: startWidth,
        }
        motion = m
        deps.rail()?.setAttribute("data-resizing", "true")
        document.body.style.userSelect = "none"
        document.body.style.cursor = "col-resize"
    }

    const pointerMove = (event: RailPointerEvent) => {
        const m = motion
        const gesture = m?.gesture
        if (!m || !gesture || gesture.pointerId !== event.pointerId) return

        gesture.pointerWidth = gesture.startWidth + (event.clientX - gesture.startX)
        const intent = resolveSidebarDragIntent(gesture.pointerWidth, m.snap !== "none")

        if (intent.kind === "collapse") {
            if (m.snap === "none") {
                startCollapse(m, intent.width)
                return
            }
            m.target = intent.width
            startGlide(m)
            return
        }
        if (m.snap !== "none") {
            cancelCollapse(m, intent.width)
            return
        }
        m.target = intent.width
        schedule(m)
    }

    const pointerEnd = (event: RailPointerEvent) => {
        const m = motion
        const gesture = m?.gesture
        if (!m || !gesture || gesture.pointerId !== event.pointerId) return

        m.gesture = null
        document.body.style.removeProperty("user-select")
        document.body.style.removeProperty("cursor")
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }

        // Collapsing keeps the stored width, so expanding again restores the rail as it was.
        const settled =
            m.snap === "none" ? clampSidebarWidth(gesture.pointerWidth) : SIDEBAR_COLLAPSED_WIDTH
        if (m.snap === "none") deps.setWidth(settled)
        m.target = settled
        if (m.current !== settled) startGlide(m)
        commitCollapseIfReady(m)
        settleIfDone(m)
    }

    /** Runs after every render: hands the width back to React or puts the painted one back. */
    const sync = (collapsed: boolean, width: number) => {
        const swapped = pendingCollapsed !== null && pendingCollapsed === collapsed
        if (swapped) pendingCollapsed = null
        const m = motion
        if (!m) return

        // Something else (the toggle) changed the rail mid-glide: let React own it again.
        if (pendingCollapsed === null && !m.gesture && collapsed !== m.collapsed) {
            finish(m)
            paint(collapsed ? SIDEBAR_COLLAPSED_WIDTH : width)
            return
        }
        paint(m.current)
        if (swapped) {
            fadeContent(m, 1, FADE_IN_MS, true)
            settleIfDone(m)
        }
    }

    const dispose = () => {
        const m = motion
        if (!m) return
        if (m.gesture) {
            document.body.style.removeProperty("user-select")
            document.body.style.removeProperty("cursor")
        }
        // Unmounted mid-collapse: the pointer already asked for it, so keep the promise.
        if (m.snap === "out") deps.setCollapsed(true)
        m.fade?.cancel()
        if (m.frame !== null) cancelAnimationFrame(m.frame)
        motion = null
    }

    return {pointerDown, pointerMove, pointerEnd, sync, dispose}
}
