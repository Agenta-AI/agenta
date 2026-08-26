/**
 * Client end of the stream inter-arrival trace (the runner's `stream-trace.ts` is the other end).
 *
 * Frame capture measured the transcript gaining one word every ~400ms. `useTypewriter` makes that
 * read as continuous typing, but the two probes together are what say WHERE the 400ms is spent:
 * gaps already present at the runner are upstream of us, gaps that only appear here belong to the
 * service or the network in between.
 *
 * Always on — one push of three numbers per delta — and inert until someone calls the dump.
 */

/** Enough for a long turn; older entries are dropped rather than growing without bound. */
const RING_SIZE = 2000

interface StreamTraceEntry {
    /** `performance.now()` when the chunk reached the client. */
    at: number
    /** `text` or `reasoning`; other chunk kinds are not recorded. */
    kind: string
    chars: number
}

const entries: StreamTraceEntry[] = []

export interface StreamTraceSummary {
    count: number
    /** Inter-arrival gaps in ms, per kind. A single sample yields no gaps. */
    gaps: Record<string, {p50: number; p90: number; max: number; n: number}>
    entries: StreamTraceEntry[]
}

const quantile = (sorted: number[], q: number): number =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]

export const summarizeStreamTrace = (samples = entries): StreamTraceSummary => {
    const byKind = new Map<string, number[]>()
    const last = new Map<string, number>()
    for (const entry of samples) {
        const previous = last.get(entry.kind)
        last.set(entry.kind, entry.at)
        if (previous === undefined) continue
        const gaps = byKind.get(entry.kind) ?? []
        gaps.push(entry.at - previous)
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
    return {count: samples.length, gaps, entries: [...samples]}
}

export const resetStreamTrace = (): void => {
    entries.length = 0
}

export const recordStreamChunk = (chunk: unknown): void => {
    const {type, delta} = (chunk ?? {}) as {type?: string; delta?: string}
    if (typeof type !== "string" || typeof delta !== "string") return
    // `text-delta` / `reasoning-delta` are the only kinds that carry visible prose.
    if (!type.endsWith("-delta")) return
    if (entries.length >= RING_SIZE) entries.shift()
    entries.push({
        at: performance.now(),
        kind: type.slice(0, -"-delta".length),
        chars: delta.length,
    })
}

/** Wrap a chunk stream so every delta is timestamped on the way past. */
export const traceStreamChunks = <T>(stream: ReadableStream<T>): ReadableStream<T> =>
    stream.pipeThrough(
        new TransformStream<T, T>({
            transform(chunk, controller) {
                recordStreamChunk(chunk)
                controller.enqueue(chunk)
            },
        }),
    )

/**
 * `window.__agentaStreamTrace()` dumps the summary from the console; `(true)` clears it first so
 * the next turn is measured on its own.
 */
export const installStreamTraceHelper = (): void => {
    if (typeof window === "undefined") return
    const host = window as unknown as Record<string, unknown>
    if (host.__agentaStreamTrace) return
    host.__agentaStreamTrace = (reset = false): StreamTraceSummary => {
        const summary = summarizeStreamTrace()
        if (reset) resetStreamTrace()
        return summary
    }
}
