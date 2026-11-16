import type {TurnViewModel} from "@agenta/chat/model"

type RetryableTurn = Pick<TurnViewModel, "isLast" | "status">

/**
 * Whether this turn may replay its originating message, which is the only question this app can
 * answer: position.
 *
 * WHICH failures deserve a retry is the callout's (`RETRYABLE_CODES` plus a transport failure
 * that never reached Agenta), so this gates on position and busyness and nothing else.
 */
export const runRetryAction = (
    turn: RetryableTurn,
    retry?: () => void,
): (() => void) | undefined => (turn.isLast ? retry : undefined)
