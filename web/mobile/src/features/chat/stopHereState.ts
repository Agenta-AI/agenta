export type CancelledStopAction = "settle-parked" | "settle-idle" | "abort-retry" | "await-terminal"

/** Choose the local follow-up after the server confirms a turn cancellation. */
export const cancelledStopAction = ({
    parkedAtRequest,
    parkedAtResponse,
    streaming,
    retry,
}: {
    parkedAtRequest: boolean
    parkedAtResponse: boolean
    streaming: boolean
    retry: boolean
}): CancelledStopAction => {
    if (parkedAtRequest || parkedAtResponse) return "settle-parked"
    if (!streaming) return "settle-idle"
    if (retry) return "abort-retry"
    return "await-terminal"
}
