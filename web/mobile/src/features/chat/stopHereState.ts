export type CancelledStopAction =
    | "settle-parked"
    | "settle-idle"
    | "abort-settled"
    | "abort-retry"
    | "await-terminal"

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
    if (!streaming) return "settle-idle"
    if (executionState === "idle") return "abort-settled"
    if (retry) return "abort-retry"
    return "await-terminal"
}
