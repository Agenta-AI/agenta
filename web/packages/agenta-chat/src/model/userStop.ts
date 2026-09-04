import type {UIMessage} from "ai"

type MessageWithStopMetadata = UIMessage & {metadata?: {runStopped?: boolean}}
type InteractionPart = UIMessage["parts"][number] & {state?: string}

const hasPendingInteraction = (messages: UIMessage[]): boolean =>
    messages.some(
        (message) =>
            message.role === "assistant" &&
            message.parts.some((part) => {
                const state = (part as InteractionPart).state
                return (
                    state === "approval-requested" ||
                    state === "input-available" ||
                    state === "input-streaming"
                )
            }),
    )

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

/** A pending interaction distinguishes a paused `other` finish from cancellation. */
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
            if (event.finishReason === "other" && !hasPendingInteraction(event.messages))
                return true
            return stopped
    }
}
