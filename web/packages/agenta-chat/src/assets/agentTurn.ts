import type {UIMessage} from "ai"

/**
 * The turn id for the run this browser is watching, read off the stream.
 *
 * The runner mints a browser turn's id (`services/runner/src/server.ts`, `resolveTurnId`), so the
 * client never composes one and had no way to name the turn it was watching. That is why Stop could
 * only say "cancel whatever is running", and why a Stop applied after its turn ended killed the
 * next one (#6417).
 *
 * The runner sends it as a `message-metadata` chunk, so it lands on `message.metadata.turnId`
 * beside the `sessionId` the start frame sets. It arrives third, before any content, and the SDK
 * MERGES metadata, so the finish frame's `traceId` does not overwrite it. It cannot ride on the
 * start frame itself: the SDK egress emits `start` before the runner is consulted.
 *
 * The runner half lands on `feat/session-single-turn-admission` (runner commit ca600cb1e6). Until
 * it does, no metadata arrives, nothing is stored, and Stop sends no guard, exactly as before.
 */
export const getMessageTurnId = (message: UIMessage | undefined): string | null => {
    const turnId = (message?.metadata as {turnId?: unknown} | undefined)?.turnId
    return typeof turnId === "string" && turnId.trim() ? turnId : null
}

/**
 * The turn id of the newest assistant message, or null.
 *
 * Only the newest one is consulted. An older assistant message carries an older turn's id, and
 * naming a turn that has ended would refuse a Stop that is correct.
 */
export const latestTurnId = (messages: UIMessage[]): string | null => {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        if (message.role === "user") return null
        if (message.role !== "assistant") continue
        return getMessageTurnId(message)
    }
    return null
}
