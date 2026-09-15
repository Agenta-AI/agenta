// In the order the runner emits them; create_session alone is ~78% of a cold start. Before the
// first frame the line reads "Waking up the agent".
const STARTUP_LABELS = {
    environment_starting: "Getting things ready",
    preparing_workspace: "Loading details",
    opening_session: "Almost there",
    environment_ready: "Ready",
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
