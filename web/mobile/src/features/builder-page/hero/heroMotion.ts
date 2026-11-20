/**
 * The hero's motion state, with no DOM. Each state is a set of numbers; the numbers move to
 * the new state with a critically damped spring (about 0.45 s), so a state change never jumps.
 * Speed goes into a running phase, so a faster state speeds the motion up instead of skipping.
 */

export type HeroState = "idle" | "typing" | "thinking" | "done"

export interface HeroParams {
    /** How fast the phase runs, in phase units per second. */
    speed: number
    /** How much the shape moves. */
    energy: number
    /** 0..1 weight of the thinking pattern (a darker run around the ring). */
    think: number
    /** 0..1 weight of the done pattern (the ring calms down). */
    done: number
}

export const HERO_STATE_PARAMS: Record<HeroState, HeroParams> = {
    idle: {speed: 0.22, energy: 0.3, think: 0, done: 0},
    typing: {speed: 0.42, energy: 0.55, think: 0, done: 0},
    thinking: {speed: 0.75, energy: 0.75, think: 1, done: 0},
    done: {speed: 0.1, energy: 0.12, think: 0, done: 1},
}

const KEYS = ["speed", "energy", "think", "done"] as const

// A spring with this period gets most of the way in about 0.45 s.
const SPRING_W = (2 * Math.PI) / 0.9
// The keystroke bump: a small, quick spring with some bounce.
const PULSE_W = (2 * Math.PI) / 0.35
const PULSE_DAMPING = 1.2
const PULSE_IMPULSE = 6
// The phase of the first frame. It shows the ribbon with one fold in view.
const START_PHASE = 3.7

export interface HeroMotion {
    state: HeroState
    params: HeroParams
    velocity: HeroParams
    /** The keystroke bump (see pulseMotion). */
    pulse: number
    pulseVelocity: number
    phase: number
    time: number
}

export function createMotion(state: HeroState): HeroMotion {
    return {
        state,
        params: {...HERO_STATE_PARAMS[state]},
        velocity: {speed: 0, energy: 0, think: 0, done: 0},
        pulse: 0,
        pulseVelocity: 0,
        phase: START_PHASE,
        time: 0,
    }
}

/** Advances the motion by dt seconds. */
export function stepMotion(m: HeroMotion, dt: number): void {
    const target = HERO_STATE_PARAMS[m.state]
    for (const k of KEYS) {
        const a = SPRING_W * SPRING_W * (target[k] - m.params[k]) - 2 * SPRING_W * m.velocity[k]
        m.velocity[k] += a * dt
        m.params[k] += m.velocity[k] * dt
    }
    const ap = -PULSE_W * PULSE_W * m.pulse - PULSE_DAMPING * PULSE_W * m.pulseVelocity
    m.pulseVelocity += ap * dt
    m.pulse += m.pulseVelocity * dt
    m.phase += dt * m.params.speed
    m.time += dt
}

/** Puts the motion at rest on its state, for the still frame of reduced motion. */
export function snapMotion(m: HeroMotion): void {
    m.params = {...HERO_STATE_PARAMS[m.state]}
    m.velocity = {speed: 0, energy: 0, think: 0, done: 0}
    m.pulse = 0
    m.pulseVelocity = 0
}

/** One keystroke: a small bump that fades out by itself. */
export function pulseMotion(m: HeroMotion): void {
    m.pulseVelocity += PULSE_IMPULSE
}
