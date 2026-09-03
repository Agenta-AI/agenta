// In the order the runner emits them; create_session alone is ~78% of a cold start.
const STARTUP_LABELS = {
    environment_starting: "Starting the agent",
    preparing_workspace: "Preparing the workspace",
    opening_session: "Opening the agent session",
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
