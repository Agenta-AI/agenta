/**
 * Startup copy for a cold agent turn (#6047).
 *
 * A new session spends ~15s booting its sandbox before the first token, and the chat showed a
 * wordless three-dot bubble for all of it — the run read as stalled. This module is the schedule
 * behind the line that replaces those dots.
 *
 * These labels are a TIMED GUESS, not observed state. Nothing on the wire tells the browser where a
 * cold start has got to: sandbox boot and ordinary model latency share the one window between the
 * stream's `start` chunk and its first content chunk, so the phases cannot be measured client-side.
 * They exist to narrate a normal startup, and they are deliberately vague about anything the
 * frontend cannot see. Real per-phase truth would need the runner to emit progress events.
 */

/** One step of the ladder: the elapsed mark it takes over at, and what it says. */
export interface StartupPhase {
    atMs: number
    label: string
}

/**
 * The ladder, ascending by `atMs`. The only place copy and timing are edited.
 *
 * Timings track the observed shape of a cold Claude Code start (sandbox ~3s, harness ~6s,
 * instructions ~6s, first token ~17s), front-loaded so real information arrives early — the long
 * uninformative opening was the actual complaint.
 *
 * "Working" starts at 0 rather than behind a grace window because it is the one line that is true
 * of EVERY turn, warm or cold. That is what makes an immediate label safe: a turn this misjudged as
 * cold and answers in 300ms still only ever said something correct. It is also already this
 * codebase's word for the state (see `WorkingDots` above).
 *
 * The rest stays in everyday language and out of our vocabulary — "sandbox" and "harness" name our
 * infrastructure, not anything the reader has a model of. Each line says what is happening for
 * them, which is also why the phases read as one continuing story rather than a status feed.
 */
export const STARTUP_PHASES: readonly StartupPhase[] = [
    {atMs: 0, label: "Working"},
    {atMs: 2_000, label: "Starting the agent"},
    {atMs: 8_000, label: "Preparing instructions and tools"},
    {atMs: 14_000, label: "Almost ready"},
]

/**
 * How long until the next phase takes over, or undefined once the last one has.
 *
 * Lets a caller sleep exactly to the next boundary instead of polling, and return undefined is the
 * signal to stop scheduling entirely — the final phase holds, so there is nothing left to wake for.
 */
export const msUntilNextStartupPhase = (elapsedMs: number): number | undefined => {
    const next = STARTUP_PHASES.find((phase) => phase.atMs > elapsedMs)
    return next ? next.atMs - elapsedMs : undefined
}

/**
 * The label for a turn that has been running `elapsedMs`. Null only before the ladder opens, which
 * with a phase at 0 means a negative elapsed (clock skew) — it then degrades to the plain dots.
 *
 * Monotonic by construction — it scans for the LAST phase already reached, so a label never goes
 * backwards. The final phase holds indefinitely: a very slow start keeps saying "Almost ready"
 * rather than blanking or counting seconds at the user (#6047 asks for no elapsed-time treatment).
 */
export const startupPhaseAt = (elapsedMs: number): string | null => {
    let label: string | null = null
    for (const phase of STARTUP_PHASES) {
        if (elapsedMs < phase.atMs) break
        label = phase.label
    }
    return label
}

/**
 * Whether this turn gets the ladder at all.
 *
 * `isAlive` is backend liveness (a warm-but-idle sandbox, from the project-scoped poll the tab dots
 * already run). A warm session has nothing to boot, so narrating a boot there would be a plain
 * lie — it keeps today's wordless dots instead.
 */
export const shouldShowStartupLadder = ({isAlive}: {isAlive: boolean}): boolean => !isAlive
