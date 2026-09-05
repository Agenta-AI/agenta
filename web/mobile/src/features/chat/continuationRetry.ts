import type {TurnViewModel} from "@agenta/chat/model"

type RetryableTurn = Pick<TurnViewModel, "isLast" | "status">

/** Only the latest continuation-race error can safely replay its originating message. */
export const continuationRetryAction = (
    turn: RetryableTurn,
    retry?: () => void,
): (() => void) | undefined =>
    turn.isLast && turn.status.errorCode === "continuation_resumed" ? retry : undefined
