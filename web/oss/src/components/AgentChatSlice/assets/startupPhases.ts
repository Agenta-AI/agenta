/**
 * User-facing labels for observed runner startup states.
 */

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
