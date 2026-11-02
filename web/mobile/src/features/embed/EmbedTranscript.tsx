import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {WorkingDots} from "@agenta/chat/components"
import {
    buildTurnViewModels,
    createExecutedToolIdentityCache,
    createTurnViewModelCache,
} from "@agenta/chat/model"
import type {UIMessage} from "ai"

import {mergeAssistantRuns} from "../chat/turnRuns"

import {EmbedTurn} from "./EmbedTurn"

/** The open conversation's turns, the greeting while it is empty, and a working line. */
export const EmbedTranscript = ({
    messages,
    sessionId,
    running,
    waitingForReply,
    waitingOnUser,
    fileBlob,
    greeting,
}: {
    messages: UIMessage[]
    sessionId: string
    running: boolean
    waitingForReply: boolean
    waitingOnUser: boolean
    fileBlob: (fileId: string) => Promise<Blob>
    greeting: ReactNode
}) => {
    // Mounted per conversation (keyed by session), so these caches never span two.
    const [executedFor] = useState(createExecutedToolIdentityCache)
    const [turnCache] = useState(createTurnViewModelCache)
    const turns = useMemo(
        () =>
            mergeAssistantRuns(
                buildTurnViewModels(messages, {busy: running, executedFor, cache: turnCache}),
            ),
        [messages, running, executedFor, turnCache],
    )
    const end = useRef<HTMLDivElement>(null)
    useEffect(() => {
        end.current?.scrollIntoView({block: "end"})
    }, [messages, waitingForReply])

    return (
        <div className="flex grow flex-col gap-3 p-3">
            {greeting}
            {turns.map((turn) => (
                <EmbedTurn
                    key={turn.message.id}
                    turn={turn}
                    sessionId={sessionId}
                    live={!turn.isUser && turn.isLast && running}
                    waitingOnUser={waitingOnUser}
                    fileBlob={fileBlob}
                />
            ))}
            {waitingForReply ? <WorkingDots /> : null}
            <div ref={end} />
        </div>
    )
}
