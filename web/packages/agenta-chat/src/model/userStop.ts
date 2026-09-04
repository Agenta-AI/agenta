import {isHitlPending} from "@agenta/playground/agent-chat"
import type {UIMessage} from "ai"

type MessageWithStopMetadata = UIMessage & {metadata?: {runStopped?: boolean}}

/** True only for the durable marker written on a user-cancelled assistant turn. */
export const lastTurnWasUserStopped = (messages: UIMessage[]): boolean => {
    const last = messages[messages.length - 1] as MessageWithStopMetadata | undefined
    return last?.role === "assistant" && last.metadata?.runStopped === true
}

export type UserStoppedStateEvent =
    | {type: "user-stop"}
    | {type: "reset"}
    | {type: "transcript"; messages: UIMessage[]}
    | {
          type: "stream-terminal"
          messages: UIMessage[]
          finishReason?: string
      }

/**
 * One neutral stopped-state reducer for desktop and mobile.
 *
 * The Vercel adapter maps the runner's `cancelled` and `paused` terminal reasons to `other`.
 * A paused stream still has a live HITL gate, which distinguishes it from a cancelled one. Durable
 * replay is unambiguous because the transcript adapter preserves `stopReason: "cancelled"` as
 * `metadata.runStopped`.
 */
export const reduceUserStoppedState = (stopped: boolean, event: UserStoppedStateEvent): boolean => {
    switch (event.type) {
        case "user-stop":
            return true
        case "reset":
            return false
        case "transcript":
            return lastTurnWasUserStopped(event.messages) || stopped
        case "stream-terminal":
            if (lastTurnWasUserStopped(event.messages)) return true
            if (event.finishReason === "other" && !isHitlPending(event.messages)) return true
            return stopped
    }
}
