/**
 * The startup ladder for a cold agent turn (#6047).
 *
 * The labels are a TIMED GUESS, not observed state: sandbox boot and ordinary model latency share
 * the one window between the stream's `start` chunk and its first content chunk, so nothing
 * client-side can tell them apart. Real per-phase truth would need the runner to emit events.
 */

/** One step of the ladder: the elapsed mark it takes over at, and what it says. */
export interface StartupPhase {
    atMs: number
    label: string
}

/**
 * The ladder, ascending by `atMs` — the only place copy and timing are edited.
 *
 * "Working" sits at 0 with no grace window because it is the one line true of EVERY turn, so a turn
 * misjudged as cold that answers in 300ms still only ever said something correct.
 */
export const STARTUP_PHASES: readonly StartupPhase[] = [
    {atMs: 0, label: "Working"},
    {atMs: 2_000, label: "Starting the agent"},
    {atMs: 8_000, label: "Preparing instructions and tools"},
    {atMs: 14_000, label: "Almost ready"},
]

/** ms to the next phase; undefined once the last one lands, which tells callers to stop scheduling. */
export const msUntilNextStartupPhase = (elapsedMs: number): number | undefined => {
    const next = STARTUP_PHASES.find((phase) => phase.atMs > elapsedMs)
    return next ? next.atMs - elapsedMs : undefined
}

/** The last phase reached, so the label never goes backwards; the final one holds. */
export const startupPhaseAt = (elapsedMs: number): string | null => {
    let label: string | null = null
    for (const phase of STARTUP_PHASES) {
        if (elapsedMs < phase.atMs) break
        label = phase.label
    }
    return label
}

/** A warm session has nothing to boot, so narrating a startup there would be a plain lie. */
export const shouldShowStartupLadder = ({isAlive}: {isAlive: boolean}): boolean => !isAlive
