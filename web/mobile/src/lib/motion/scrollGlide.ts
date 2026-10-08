/**
 * A scroll glide that can chase a moving target: one critically damped spring (no overshoot)
 * keeps running while `to()` retargets it, so streamed growth reads as one continuous motion
 * instead of a restart per chunk. Timing comes from the motion presets (`scrollGlideMs`).
 */

/** ωt at which a critically damped spring is within 1% of its target. */
const SETTLE_OMEGA_T = 6.64

/** Close enough to stop: under half a pixel away and barely moving (px/s). */
const REST_OFFSET_PX = 0.5
const REST_SPEED = 5

/** A long frame gap (a background tab) advances at most this much, in seconds. */
const MAX_STEP_S = 0.064

/** Stiffness (ω) that settles the spring to within 1% of its distance in `settleMs`. */
export const omegaFor = (settleMs: number) => SETTLE_OMEGA_T / (settleMs / 1000)

/** Exact step of a critically damped spring: stable for any `dt`, so a dropped frame never overshoots. */
export const springStep = (offset: number, velocity: number, omega: number, dt: number) => {
    const decay = Math.exp(-omega * dt)
    const c = velocity + omega * offset
    return {offset: (offset + c * dt) * decay, velocity: (velocity - omega * c * dt) * decay}
}

export interface ScrollGlide {
    /** Where the glide is heading, or null at rest. */
    readonly target: number | null
    /** Starts a glide, or retargets the running one with its current velocity. */
    to: (top: number, settleMs: number) => void
    stop: () => void
}

export function createScrollGlide(el: HTMLElement, onRest: () => void): ScrollGlide {
    let target: number | null = null
    let omega = 0
    // Tracked apart from scrollTop, which the browser rounds: rounding would stall a slow tail.
    let position = 0
    let velocity = 0
    let last = 0
    let frame = 0

    const tick = (now: number) => {
        if (target === null) return
        const dt = last ? Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000)) : 1 / 60
        last = now
        const next = springStep(position - target, velocity, omega, dt)
        position = target + next.offset
        velocity = next.velocity
        if (Math.abs(next.offset) < REST_OFFSET_PX && Math.abs(velocity) < REST_SPEED) {
            el.scrollTop = target
            target = null
            onRest()
            return
        }
        el.scrollTop = position
        frame = requestAnimationFrame(tick)
    }

    return {
        get target() {
            return target
        },
        to(top, settleMs) {
            omega = omegaFor(settleMs)
            if (target === null) {
                position = el.scrollTop
                velocity = 0
                last = 0
                frame = requestAnimationFrame(tick)
            }
            target = top
        },
        stop() {
            if (target !== null) cancelAnimationFrame(frame)
            target = null
            velocity = 0
        },
    }
}
