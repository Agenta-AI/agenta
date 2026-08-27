/**
 * Client end of the stream inter-arrival trace (the runner's `stream-trace.ts` is the other end).
 *
 * Frame capture measured the transcript gaining one word every ~400ms. `useTypewriter` makes that
 * read as continuous typing, but the two probes together are what say WHERE the 400ms is spent:
 * gaps already present at the runner are upstream of us, gaps that appear only here belong to the
 * service or the network in between.
 *
 * Opt-in, like the runner half — arm it with `window.__agentaStreamTrace.enable()` (persisted, so
 * it survives the reload) and read it with `window.__agentaStreamTrace()`.
 */

/** Enough for a long turn; the oldest entry is overwritten rather than growing without bound. */
const RING_SIZE = 2000

/** localStorage key that arms recording. The helper is always installed; recording is not. */
export const STREAM_TRACE_KEY = "agenta:stream-trace"

interface StreamTraceEntry {
    /** `performance.now()` when the chunk reached the client. */
    at: number
    /** `text` or `reasoning`; other chunk kinds are not recorded. */
    kind: string
    chars: number
    /** Which turn this arrived in — gaps are never measured across a turn boundary. */
    turn: number
}

// Fixed-size ring with a write index: `shift()` on a full array would re-index 2000 entries on
// every delta, on the stream's hot path.
const ring: (StreamTraceEntry | undefined)[] = new Array(RING_SIZE)
let writeIndex = 0
let written = 0
let currentTurn = 0

const readEntries = (): StreamTraceEntry[] => {
    const out: StreamTraceEntry[] = []
    const count = Math.min(written, RING_SIZE)
    const start = written > RING_SIZE ? writeIndex : 0
    for (let i = 0; i < count; i++) {
        const entry = ring[(start + i) % RING_SIZE]
        if (entry) out.push(entry)
    }
    return out
}

let armed: boolean | undefined

const isArmed = (): boolean => {
    if (armed !== undefined) return armed
    try {
        armed =
            typeof localStorage !== "undefined" && localStorage.getItem(STREAM_TRACE_KEY) === "1"
    } catch {
        armed = false
    }
    return armed
}

export interface StreamTraceSummary {
    count: number
    /** Inter-arrival gaps in ms, per kind. A single sample yields no gaps. */
    gaps: Record<string, {p50: number; p90: number; max: number; n: number}>
    entries: StreamTraceEntry[]
}

const quantile = (sorted: number[], q: number): number =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]

export const summarizeStreamTrace = (samples = readEntries()): StreamTraceSummary => {
    const byKind = new Map<string, number[]>()
    const last = new Map<string, StreamTraceEntry>()
    for (const entry of samples) {
        const previous = last.get(entry.kind)
        last.set(entry.kind, entry)
        // Idle time BETWEEN turns is not an inter-arrival gap; counting it would put the
        // user's think-time in the histogram and wreck the p90 this exists to report.
        if (previous === undefined || previous.turn !== entry.turn) continue
        const gaps = byKind.get(entry.kind) ?? []
        gaps.push(entry.at - previous.at)
        byKind.set(entry.kind, gaps)
    }
    const gaps: StreamTraceSummary["gaps"] = {}
    for (const [kind, values] of byKind) {
        const sorted = [...values].sort((a, b) => a - b)
        gaps[kind] = {
            p50: Math.round(quantile(sorted, 0.5)),
            p90: Math.round(quantile(sorted, 0.9)),
            max: Math.round(sorted[sorted.length - 1] ?? 0),
            n: sorted.length,
        }
    }
    return {count: samples.length, gaps, entries: samples}
}

export const resetStreamTrace = (): void => {
    ring.fill(undefined)
    writeIndex = 0
    written = 0
    currentTurn = 0
}

/** Test seam: force the armed state instead of going through localStorage. */
export const setStreamTraceArmed = (value: boolean | undefined): void => {
    armed = value
}

export const recordStreamChunk = (chunk: unknown): void => {
    if (!isArmed()) return
    const {type, delta} = (chunk ?? {}) as {type?: string; delta?: string}
    if (typeof type !== "string") return
    // Each response opens with `start`; that is the turn boundary the gap maths needs.
    if (type === "start") {
        currentTurn += 1
        return
    }
    if (typeof delta !== "string" || !type.endsWith("-delta")) return
    ring[writeIndex] = {
        at: performance.now(),
        kind: type.slice(0, -"-delta".length),
        chars: delta.length,
        turn: currentTurn,
    }
    writeIndex = (writeIndex + 1) % RING_SIZE
    written += 1
}

/** Wrap a chunk stream so every delta is timestamped on the way past. */
export const traceStreamChunks = <T>(stream: ReadableStream<T>): ReadableStream<T> => {
    if (!isArmed()) return stream
    return stream.pipeThrough(
        new TransformStream<T, T>({
            transform(chunk, controller) {
                recordStreamChunk(chunk)
                controller.enqueue(chunk)
            },
        }),
    )
}

/**
 * `window.__agentaStreamTrace()` dumps the summary; `(true)` clears it first. `.enable()` /
 * `.disable()` arm recording for later sessions — nothing is recorded until enabled.
 */
export const installStreamTraceHelper = (): void => {
    if (typeof window === "undefined") return
    const host = window as unknown as Record<string, unknown>
    if (host.__agentaStreamTrace) return
    const dump = (reset = false): StreamTraceSummary => {
        const summary = summarizeStreamTrace()
        if (reset) resetStreamTrace()
        return summary
    }
    const setArmed = (value: boolean) => {
        armed = value
        try {
            if (value) localStorage.setItem(STREAM_TRACE_KEY, "1")
            else localStorage.removeItem(STREAM_TRACE_KEY)
        } catch {
            // A blocked store still arms this tab; only persistence is lost.
        }
    }
    host.__agentaStreamTrace = Object.assign(dump, {
        enable: () => setArmed(true),
        disable: () => setArmed(false),
        reset: resetStreamTrace,
    })
}
