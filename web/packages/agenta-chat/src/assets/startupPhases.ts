const STARTUP_LABELS = {
    environment_starting: "Starting the agent",
    environment_ready: "Agent ready",
} as const

export const startupLabelFromDataPart = (part: unknown): string | null => {
    if (!part || typeof part !== "object") return null
    const candidate = part as {type?: unknown; data?: {phase?: unknown}}
    if (candidate.type !== "data-agent-status") return null
    const phase = candidate.data?.phase
    // `in` would also accept inherited keys such as "toString", returning a function.
    return typeof phase === "string" && Object.prototype.hasOwnProperty.call(STARTUP_LABELS, phase)
        ? STARTUP_LABELS[phase as keyof typeof STARTUP_LABELS]
        : null
}
