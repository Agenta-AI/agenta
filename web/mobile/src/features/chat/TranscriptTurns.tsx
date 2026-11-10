import type {RefObject} from "react"

import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import type {TurnViewModel} from "@agenta/chat/model"

import {PendingTurn} from "./PendingTurn"
import {TurnRow} from "./TurnRow"
import {runIdFor, runStartedAtFor} from "./turnStatus"
import {useTranscriptWindow} from "./useTranscriptWindow"

/** The transcript's turns, and the placeholder turn while a run has nothing to show yet. */
export const TranscriptTurns = ({
    turns,
    scrollerRef,
    sessionId,
    remoteRunning,
    waitingOnUser,
    resuming = false,
    pending,
    onClientToolOutput,
    onRewind,
}: {
    turns: TurnViewModel[]
    /** The element these turns scroll in; scrolling it up is what renders older turns. */
    scrollerRef: RefObject<HTMLDivElement | null>
    sessionId: string
    remoteRunning: boolean
    waitingOnUser: boolean
    /** An answered ask the transcript has not caught up with yet. */
    resuming?: boolean
    /** The request is in and no assistant turn exists yet. */
    pending: boolean
    onClientToolOutput?: ClientToolOutputHandler
    onRewind?: (turn: TurnViewModel) => void
}) => {
    const start = useTranscriptWindow(turns.length, scrollerRef)
    return (
        <>
            {turns.slice(start).map((turn, offset) => (
                <TurnRow
                    key={turn.message.id}
                    turn={turn}
                    onClientToolOutput={onClientToolOutput}
                    onRewind={onRewind}
                    sessionId={sessionId}
                    remoteRunning={remoteRunning}
                    waitingOnUser={waitingOnUser}
                    resuming={resuming}
                    runId={runIdFor(turns, start + offset)}
                    runStartedAt={runStartedAtFor(turns, start + offset)}
                />
            ))}
            {pending ? (
                <PendingTurn sessionId={sessionId} runId={runIdFor(turns, turns.length)} />
            ) : null}
        </>
    )
}
