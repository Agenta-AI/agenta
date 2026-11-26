// A records refresh reads the session turns only for a turn it shows ended.
import {revalidateSessionTurnsOnTurnEndAtom} from "@agenta/entities/session"
import type {UIMessage} from "ai"
import {atom} from "jotai"

interface TerminalMetadata {
    traceId?: unknown
    recordTerminal?: unknown
    runStopped?: unknown
    paused?: unknown
}

/** The trace ids of the ended turns in a transcript: its terminal assistant messages. */
export const endedTurnTraceIds = (messages: UIMessage[]): string[] =>
    messages.flatMap((message) => {
        if (message.role !== "assistant") return []
        const metadata = (message.metadata ?? {}) as TerminalMetadata
        const ended = metadata.recordTerminal || metadata.runStopped || metadata.paused
        return ended && typeof metadata.traceId === "string" ? [metadata.traceId] : []
    })

export const refreshSessionTurnsOnTurnEndAtom = atom(
    null,
    (_get, set, {sessionId, messages}: {sessionId: string; messages: UIMessage[]}) =>
        set(revalidateSessionTurnsOnTurnEndAtom, {
            sessionId,
            endedTraceIds: endedTurnTraceIds(messages),
        }),
)
