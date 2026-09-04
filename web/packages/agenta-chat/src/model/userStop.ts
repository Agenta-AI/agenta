import {isHitlPending} from "@agenta/playground/agent-chat"
import type {UIMessage} from "ai"

type MessageWithStopMetadata = UIMessage & {metadata?: {runStopped?: boolean}}

/** True only for the durable marker written on a user-cancelled assistant turn. */
export const lastTurnWasUserStopped = (messages: UIMessage[]): boolean => {
    const last = messages[messages.length - 1] as MessageWithStopMetadata | undefined
    return last?.role === "assistant" && last.metadata?.runStopped === true
}

/**
 * Recognize an explicit runner user-stop label without treating a generic AbortError as a Stop.
 * Network disconnects and unrelated aborts must remain failures; only the runner's stable
 * `user-stop` marker is neutral.
 */
export const isUserStopError = (error: unknown): boolean => {
    const raw = error instanceof Error ? error.message : error
    let value = raw
    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw)
        } catch {
            return raw.trim().toLowerCase() === "user-stop"
        }
    }
    if (!value || typeof value !== "object") return false

    const root = value as Record<string, unknown>
    const status =
        root.status && typeof root.status === "object"
            ? (root.status as Record<string, unknown>)
            : root
    return root.agentaAbort === "user-stop" || status.code === "user-stop"
}

export type UserStoppedStateEvent =
    | {type: "user-stop"}
    | {type: "reset"}
    | {type: "transcript"; messages: UIMessage[]}
    | {
          type: "stream-terminal"
          messages: UIMessage[]
          finishReason?: string
          error?: unknown
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
            if (lastTurnWasUserStopped(event.messages) || isUserStopError(event.error)) return true
            if (event.finishReason === "other" && !isHitlPending(event.messages)) return true
            return stopped
    }
}
