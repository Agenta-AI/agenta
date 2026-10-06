// Three dots on 3D paths as pure functions of time; coordinates are in ring radii, centred on 0.

export type AgentActivityFormat =
    | "working"
    | "thinking"
    | "tool"
    | "searching"
    | "planning"
    | "subagents"
    | "evaluating"
    | "writing"

interface Point {
    x: number
    y: number
    z: number
    /** Size factor; 1 is a front dot. */
    s: number
}

interface PaintedDot {
    x: number
    y: number
    r: number
    alpha: number
}

interface DotsFrame {
    dots: PaintedDot[]
    alpha: number
}

const TAU = Math.PI * 2
const FOCAL = 2.8
const DOT = 0.25
const MERGED = 0.6
const SHRUNK = 0.33
const T_MERGE = 0.12
const T_SHRINK = 0.16
const T_BURST = 0.26

/** Half the drawing's width in ring radii; the host maps this to half the canvas. */
export const DOTS_EXTENT = 1.41

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (v: number) => v * v * (3 - 2 * v)
const lerp = (a: number, b: number, e: number) => a + (b - a) * e
const inOut = (e: number) => (e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2)
const easeOut = (e: number) => 1 - Math.pow(1 - e, 3)
const easeIn = (e: number) => e * e * e
/** Step counter that holds for `hold` of each period, then eases to the next step. */
const stepped = (t: number, period: number, hold: number) => {
    const k = Math.floor(t / period)
    return k + inOut(clamp((t / period - k - hold) / (1 - hold)))
}
const depth = (z: number, min: number) => min + (1 - min) * smooth(clamp((z + 1) / 1.6))
const rotZ = (p: Point, g: number): Point => ({
    ...p,
    x: p.x * Math.cos(g) - p.y * Math.sin(g),
    y: p.x * Math.sin(g) + p.y * Math.cos(g),
})
const ring = (a: number) => ({x: Math.sin(a), y: 0, z: Math.cos(a)})
const THREE = [0, 1, 2]

const TRIANGLE = THREE.map((j) => {
    const a = -Math.PI / 2 + (j * TAU) / 3
    return [0.95 * Math.cos(a), 0.95 * Math.sin(a)] as const
})

const FORMATS: Record<AgentActivityFormat, (t: number) => Point[]> = {
    // Edge-on ring turning in eased 60° steps with a hold after each.
    working: (t) => {
        const th = (stepped(t, 0.7, 0.5) * TAU) / 6
        return THREE.map((i) => {
            const p = ring(th + (i * TAU) / 3)
            return {...p, s: depth(p.z, 0.6)}
        })
    },
    // Continuous spin; the ring tilts open, closes, then tilts the other way.
    thinking: (t) => {
        const u = (t * TAU) / 3.6
        const b = 0.7 * Math.pow(Math.sin(u), 3)
        const g = 0.25 * Math.sin(u * 0.5)
        return THREE.map((i) => {
            const p = ring(t * Math.PI + (i * TAU) / 3)
            const q = rotZ({x: p.x, y: -p.z * Math.sin(b), z: p.z * Math.cos(b), s: 0}, g)
            return {...q, s: depth(q.z, 0.6)}
        })
    },
    // Each dot swings between opposite hexagon corners, behind the centre.
    tool: (t) =>
        [-30, 30, 90].map((deg, i) => {
            const ax = (deg * Math.PI) / 180
            const tt = t - i * 0.35
            const k = Math.floor(tt / 1.05)
            const e = inOut(clamp((tt / 1.05 - k - 0.45) / 0.55))
            const psi = k % 2 ? Math.PI * (1 - e) : Math.PI * e
            const c = Math.cos(psi)
            const z = -Math.sin(psi)
            return {
                x: c * Math.cos(ax),
                y: c * Math.sin(ax),
                z,
                s: 1.15 * (0.06 + 0.94 * smooth(z + 1)),
            }
        }),
    // Dots chase each other along a 3D figure eight.
    searching: (t) => {
        const u = (t * TAU) / 2.4
        const g = 0.35 * Math.sin(t * 0.4)
        return THREE.map((i) => {
            const p = u + (i * TAU) / 3
            const q = rotZ({x: Math.sin(p), y: 0.45 * Math.sin(2 * p), z: Math.cos(p), s: 0}, g)
            return {...q, s: depth(q.z, 0.45)}
        })
    },
    // A triangle flips 180° over one corner at a time; the other two trade places.
    planning: (t) => {
        const steps = Math.floor(t / 0.9)
        const e = inOut(clamp((t / 0.9 - steps - 0.5) / 0.5))
        const perm = [0, 1, 2]
        for (let s = 0; s < steps % 6; s++) {
            const k = s % 3
            const a = perm.indexOf((k + 1) % 3)
            const b = perm.indexOf((k + 2) % 3)
            ;[perm[a], perm[b]] = [perm[b], perm[a]]
        }
        const k = steps % 3
        const ax = TRIANGLE[k][0] / 0.95
        const ay = TRIANGLE[k][1] / 0.95
        const c = Math.cos(Math.PI * e)
        const sn = Math.sin(Math.PI * e)
        return perm.map((v) => {
            const [px, py] = TRIANGLE[v]
            const along = ax * px + ay * py
            const z = (ax * py - ay * px) * sn
            return {
                x: px * c + ax * along * (1 - c),
                y: py * c + ay * along * (1 - c),
                z,
                s: depth(z, 0.55),
            }
        })
    },
    // Three tilted orbits at different speeds, like an atom.
    subagents: (t) =>
        THREE.map((i) => {
            const a = ((t * TAU) / 1.6) * (1 + 0.12 * i) + i * 2.1
            const q = rotZ(
                {x: 0.95 * Math.cos(a), y: 0.3 * Math.sin(a), z: Math.sin(a), s: 0},
                (i * Math.PI) / 3 - Math.PI / 6,
            )
            return {...q, s: depth(q.z, 0.5)}
        }),
    // A centre dot holds while the other two trade sides around it.
    evaluating: (t) => {
        const th = stepped(t, 1, 0.45) * Math.PI
        const pair = [0, 1].map((j) => {
            const a = th + j * Math.PI
            const q = rotZ(
                {x: 0.95 * Math.cos(a), y: 0.28 * Math.sin(a), z: Math.sin(a), s: 0},
                -0.35,
            )
            return {...q, s: depth(q.z, 0.5)}
        })
        return [{x: 0, y: 0, z: 0, s: 0.95}, ...pair]
    },
    // Typing dots in 3D: each lifts and comes forward in turn.
    writing: (t) =>
        THREE.map((i) => {
            const f = ((((t - i * 0.16) / 1.25) % 1) + 1) % 1
            const bump = f < 0.42 ? Math.sin((f / 0.42) * Math.PI) : 0
            const z = 0.8 * bump - 0.2
            return {x: (i - 1) * 0.9, y: -0.42 * bump, z, s: depth(z, 0.6)}
        }),
}

const STILL_ROW: Point[] = [-0.9, 0, 0.9].map((x) => ({x, y: 0, z: 0, s: 0.85}))

/** One format's frame; `g` pulls it into the centre (1 = fully merged). */
function compose(
    format: AgentActivityFormat,
    t: number,
    g: number,
    merged: number,
    reduced: boolean,
) {
    const points = reduced ? STILL_ROW : FORMATS[format](t)
    const dots = points
        .map((p) => {
            const P = (FOCAL / (FOCAL - p.z)) * (1 - g)
            return {
                x: p.x * P,
                y: p.y * P,
                z: p.z,
                r: Math.max(0, DOT * lerp(p.s, merged, g)),
                alpha: 1,
            }
        })
        .sort((a, b) => a.z - b.z)
    return dots
}

/** A format change in flight: the format shown, the one it left, and when it began. */
export interface DotsSwitch {
    format: AgentActivityFormat
    previous: AgentActivityFormat | null
    since: number
    /** How merged the old format already was when this switch cut in. */
    mergeFrom: number
}

/** Applies a format change at `t`; a change mid-switch retargets or merges back from where the dots are. */
export function switchTo(state: DotsSwitch, format: AgentActivityFormat, t: number): DotsSwitch {
    if (format === state.format) return state
    const dt = t - state.since
    if (state.previous !== null && dt < T_MERGE + T_SHRINK) return {...state, format}
    const bursting = state.previous !== null && dt < T_MERGE + T_SHRINK + T_BURST
    const mergeFrom = bursting ? 1 - easeOut((dt - T_MERGE - T_SHRINK) / T_BURST) : 0
    return {format, previous: state.format, since: t, mergeFrom}
}

/** The frame at `t` seconds: a switch merges the old dots, shrinks them, then bursts the new format. */
export function dotsFrame({
    format,
    previous,
    since,
    mergeFrom = 0,
    t,
    reduced = false,
}: DotsSwitch & {t: number; reduced?: boolean}): DotsFrame {
    const alpha = reduced ? 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(t * 4)) : 1
    const dt = t - since
    const switching = previous !== null && !reduced
    if (switching && dt < T_MERGE) {
        const g = mergeFrom + (1 - mergeFrom) * easeIn(dt / T_MERGE)
        return {dots: compose(previous, t, g, MERGED, reduced), alpha}
    }
    if (switching && dt < T_MERGE + T_SHRINK) {
        const r = DOT * lerp(MERGED, SHRUNK, smooth((dt - T_MERGE) / T_SHRINK))
        return {dots: [{x: 0, y: 0, r, alpha: 1}], alpha}
    }
    if (switching && dt < T_MERGE + T_SHRINK + T_BURST) {
        const g = 1 - easeOut((dt - T_MERGE - T_SHRINK) / T_BURST)
        return {dots: compose(format, t, g, SHRUNK, reduced), alpha}
    }
    return {dots: compose(format, t, 0, MERGED, reduced), alpha}
}
