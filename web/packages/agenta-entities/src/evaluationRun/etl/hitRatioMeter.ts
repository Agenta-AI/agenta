/**
 * Hit-ratio meter — the v1→v2 escalation signal.
 *
 * # Why this exists
 *
 * The eval-filtering RFC (docs/designs/eval-filtering.md §D2 + §C3) defines
 * a two-engine strategy:
 *
 *   - **v1** evaluates filter predicates **client-side**, over already-loaded
 *     metric data. Cheap to ship, no backend work. Correct for high-hit-ratio
 *     predicates where most rows pass and full materialization is cheap.
 *
 *   - **v2** evaluates filter predicates **server-side** via the
 *     `scenarios/query` `filtering` parameter. Same wire format, transform
 *     becomes a no-op. Required when the predicate is low-hit-ratio — the
 *     "catastrophic case" of infinite-scroll fetching the whole run just to
 *     fill a viewport.
 *
 * The decision between v1 and v2 is data-dependent: which engine should run
 * THIS predicate against THIS dataset? The answer is encoded in the
 * hit-ratio meter:
 *
 *   - Observe `(matched / scanned)` per chunk
 *   - Roll the ratio over a window of N consecutive chunks
 *   - When the rolling ratio falls below the threshold → recommend escalation
 *
 * The RFC's default policy: window = 3 chunks, threshold = 0.10. Below 10%
 * average pass over 3 windows → escalate.
 *
 * # What this module does (today)
 *
 * It **reports the regime**. It does not swap engines. The PoC and any
 * caller consume `regime()` and decide what to do with the recommendation
 * — log it, surface a banner, swap the source, etc.
 *
 * v2 backend support is the next milestone. When it lands, the consumer
 * pattern is: "regime === 'escalate' → next chunk's source request carries
 * `filtering` payload, this transform becomes a no-op."
 *
 * # State machine
 *
 *   warming   → fewer than `windowSize` chunks observed
 *               (rolling ratio undefined → recommend keep-client by default)
 *   client    → rolling ratio ≥ threshold
 *               (v1 is comfortable — keep the client transform)
 *   escalate  → rolling ratio < threshold
 *               (v1 is wasteful — switch to v2 backend predicate)
 *
 * Transitions happen on each `record()` call. The meter is monotonic in
 * "chunks observed" but the regime itself can oscillate (rare in practice —
 * the rolling average smooths noise).
 *
 * @packageDocumentation
 */

export interface HitRatioWindow {
    /** 1-based chunk index. */
    chunk: number
    /** Rows the predicate filter saw at this chunk. */
    scanned: number
    /** Rows that passed the predicate at this chunk. */
    matched: number
    /** Per-chunk pass ratio (matched / scanned, 0..1). */
    ratio: number
}

export type HitRatioState = "warming" | "client" | "escalate"

export interface HitRatioRegime {
    /** Current recommendation. */
    state: HitRatioState
    /** Rolling-window ratio (matched/scanned summed over the window). Null while warming. */
    rollingRatio: number | null
    /** How many chunks have been recorded so far. */
    chunksObserved: number
    /** Window size (number of chunks the rolling ratio averages over). */
    windowSize: number
    /** Threshold the rolling ratio is compared against. */
    threshold: number
    /** Human-readable single-line explanation suitable for logs / banners. */
    reason: string
}

export interface HitRatioMeterOptions {
    /**
     * Number of recent chunks to average over. Default 3, matching the RFC's
     * "below threshold over 3 windows" trigger.
     */
    windowSize?: number
    /**
     * Rolling-ratio threshold for escalation. Default 0.10 (10%) — the RFC's
     * recommended starting point. Below this → recommend v2.
     */
    threshold?: number
}

export interface HitRatioMeter {
    /** Record a chunk's stats. Idempotent on repeated calls for the same chunk index. */
    record: (args: {chunk: number; scanned: number; matched: number}) => void
    /** Compute the current regime. Pure read — does not mutate state. */
    regime: () => HitRatioRegime
    /** All recorded windows, in chunk order. */
    windows: () => HitRatioWindow[]
    /** Drop all observations — useful when starting a new predicate. */
    reset: () => void
    /** Configured window size + threshold (for diagnostics). */
    readonly config: {windowSize: number; threshold: number}
}

const DEFAULT_WINDOW = 3
const DEFAULT_THRESHOLD = 0.1

export function createHitRatioMeter(options: HitRatioMeterOptions = {}): HitRatioMeter {
    const windowSize = options.windowSize ?? DEFAULT_WINDOW
    const threshold = options.threshold ?? DEFAULT_THRESHOLD

    if (windowSize < 1) throw new Error(`windowSize must be >= 1, got ${windowSize}`)
    if (threshold < 0 || threshold > 1) {
        throw new Error(`threshold must be between 0 and 1, got ${threshold}`)
    }

    let observed: HitRatioWindow[] = []
    const seenChunks = new Set<number>()

    function record(args: {chunk: number; scanned: number; matched: number}) {
        // Dedup by chunk index — the predicate filter emits one event per
        // predicate per chunk, but for meter purposes we only need one entry
        // per chunk. Caller is responsible for passing aggregate stats.
        if (seenChunks.has(args.chunk)) return
        seenChunks.add(args.chunk)
        observed.push({
            chunk: args.chunk,
            scanned: args.scanned,
            matched: args.matched,
            ratio: args.scanned > 0 ? args.matched / args.scanned : 0,
        })
    }

    function regime(): HitRatioRegime {
        const chunksObserved = observed.length
        if (chunksObserved < windowSize) {
            return {
                state: "warming",
                rollingRatio: null,
                chunksObserved,
                windowSize,
                threshold,
                reason: `warming (${chunksObserved}/${windowSize} chunks observed — need ${windowSize} before recommending)`,
            }
        }

        const tail = observed.slice(-windowSize)
        const totalScanned = tail.reduce((a, w) => a + w.scanned, 0)
        const totalMatched = tail.reduce((a, w) => a + w.matched, 0)
        const rollingRatio = totalScanned > 0 ? totalMatched / totalScanned : 0

        if (rollingRatio < threshold) {
            return {
                state: "escalate",
                rollingRatio,
                chunksObserved,
                windowSize,
                threshold,
                reason: `rolling ratio ${(rollingRatio * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% threshold over last ${windowSize} chunks — recommend v2 server-side filter`,
            }
        }

        return {
            state: "client",
            rollingRatio,
            chunksObserved,
            windowSize,
            threshold,
            reason: `rolling ratio ${(rollingRatio * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}% threshold over last ${windowSize} chunks — v1 client filter is appropriate`,
        }
    }

    function reset() {
        observed = []
        seenChunks.clear()
    }

    return {
        record,
        regime,
        windows: () => observed.slice(),
        reset,
        config: {windowSize, threshold},
    }
}
