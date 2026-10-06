export type CancelledStopAction =
    | "settle-parked"
    | "settle-idle"
    | "abort-settled"
    | "abort-retry"
    | "await-terminal"
    | "await-server"

/** Choose the local follow-up after the server confirms a turn cancellation. */
export const cancelledStopAction = ({
    parkedAtRequest,
    parkedAtResponse,
    streaming,
    retry,
    executionState,
}: {
    parkedAtRequest: boolean
    parkedAtResponse: boolean
    streaming: boolean
    retry: boolean
    executionState: "stopping" | "idle"
}): CancelledStopAction => {
    if (parkedAtRequest || parkedAtResponse) return "settle-parked"
    if (executionState === "idle") return streaming ? "abort-settled" : "settle-idle"
    // A run not streamed here stays Stopping until the server marks it or the run ends.
    if (!streaming) return "await-server"
    if (retry) return "abort-retry"
    return "await-terminal"
}
