/**
 * User-facing labels for observed runner startup states.
 */

/** Safe feedback before the runner reports its first observed boundary. */
export const INITIAL_STARTUP_LABEL = "Working"

const STARTUP_LABELS = {
    environment_starting: "Starting the agent",
    environment_ready: "Agent ready",
} as const

export const startupLabelFromDataPart = (part: unknown): string | null => {
    if (!part || typeof part !== "object") return null
    const candidate = part as {type?: unknown; data?: {phase?: unknown}}
    if (candidate.type !== "data-agent-status") return null
    const phase = candidate.data?.phase
    return typeof phase === "string" && phase in STARTUP_LABELS
        ? STARTUP_LABELS[phase as keyof typeof STARTUP_LABELS]
        : null
}

/** A warm session has nothing to boot, so narrating a startup there would be a plain lie. */
export const shouldShowStartupLadder = ({isAlive}: {isAlive: boolean}): boolean => !isAlive
