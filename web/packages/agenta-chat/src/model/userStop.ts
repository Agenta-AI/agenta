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

export interface UserStoppedState {
    stopped: boolean
    turnIdentity: string | null
}

const lastTurnIdentity = (messages: UIMessage[]): string | null => {
    const last = messages[messages.length - 1]
    if (!last) return null
    const turnId = (last.metadata as {turnId?: unknown} | undefined)?.turnId
    if (typeof turnId === "string" && turnId.trim()) return `turn:${turnId}`
    return `message:${messages.length}:${last.role}:${last.id}`
}

export const createUserStoppedState = (messages: UIMessage[]): UserStoppedState => ({
    stopped: lastTurnWasUserStopped(messages),
    turnIdentity: lastTurnIdentity(messages),
})

const adoptTranscript = (state: UserStoppedState, messages: UIMessage[]): UserStoppedState => {
    const turnIdentity = lastTurnIdentity(messages)
    if (lastTurnWasUserStopped(messages)) return {stopped: true, turnIdentity}
    const adoptedNewerTurn =
        state.stopped && state.turnIdentity !== null && turnIdentity !== state.turnIdentity
    return {stopped: adoptedNewerTurn ? false : state.stopped, turnIdentity}
}

/** A pending interaction distinguishes a paused `other` finish from cancellation. */
export const reduceUserStoppedState = (
    state: UserStoppedState,
    event: UserStoppedStateEvent,
): UserStoppedState => {
    switch (event.type) {
        case "user-stop":
            return {...state, stopped: true}
        case "reset":
            return {...state, stopped: false}
        case "transcript":
            return adoptTranscript(state, event.messages)
        case "stream-terminal": {
            const adopted = adoptTranscript(state, event.messages)
            if (lastTurnWasUserStopped(event.messages)) return adopted
            if (event.finishReason === "other" && !hasPendingInteraction(event.messages))
                return {...adopted, stopped: true}
            return adopted
        }
    }
}
