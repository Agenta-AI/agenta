import type {UIMessage} from "ai"

/** Read the runner-minted turn id from merged stream metadata. */
export const getMessageTurnId = (message: UIMessage | undefined): string | null => {
    const turnId = (message?.metadata as {turnId?: unknown} | undefined)?.turnId
    return typeof turnId === "string" && turnId.trim() ? turnId : null
}

/** Read only the newest assistant turn id; older ids are unsafe Stop guards. */
export const latestTurnId = (messages: UIMessage[]): string | null => {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.role !== "assistant") continue
        return getMessageTurnId(message)
    }
    return null
}
