import type {TurnViewModel} from "@agenta/chat/model"

type RetryableTurn = Pick<TurnViewModel, "isLast" | "status">

/**
 * Whether this turn may replay its originating message, which is the only question this app can
 * answer: position.
 *
 * WHICH failures deserve a retry is the callout's, in one place for both apps
 * (`RETRYABLE_CODES` plus a transport failure that never reached Agenta). This used to narrow it
 * again to `continuation_resumed` alone, so a rate limit, a lost execution or a request that never
 * arrived drew no button on a phone and did on the desktop. The desktop host gates on position and
 * busyness and nothing else; this is the same rule.
 */
export const runRetryAction = (
    turn: RetryableTurn,
    retry?: () => void,
): (() => void) | undefined => (turn.isLast ? retry : undefined)
