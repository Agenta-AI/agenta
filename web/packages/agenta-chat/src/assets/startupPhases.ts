/**
 * The acquire stages, in the order the runner emits them.
 *
 * #6047 shipped two states, so one label covered the whole acquire and a cold start showed a
 * single static line for as long as it took. The runner already timed the stages inside it;
 * these are the two worth naming, measured on a trivial first turn:
 *
 *     sandbox_start        0.6s
 *     prepare_workspace    0.7s   -> preparing_workspace
 *     probe_capabilities   1.4s
 *     create_session      19.2s   -> opening_session   (78% of the wait)
 *     acquire_total       24.5s
 *
 * An unknown phase yields null and the previous label stands, so the runner can add stages
 * without the UI having to know them.
 */
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
