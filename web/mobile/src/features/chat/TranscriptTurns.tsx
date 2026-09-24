import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import type {TurnViewModel} from "@agenta/chat/model"

import {PendingTurn} from "./PendingTurn"
import {TurnRow} from "./TurnRow"
import {isFirstResponse, runIdFor} from "./turnStatus"

/** The transcript's turns, and the placeholder turn while a run has nothing to show yet. */
export const TranscriptTurns = ({
    turns,
    sessionId,
    remoteRunning,
    waitingOnUser,
    resuming = false,
    pending,
    onClientToolOutput,
    onRewind,
}: {
    turns: TurnViewModel[]
    sessionId: string
    remoteRunning: boolean
    waitingOnUser: boolean
    /** An answered ask the transcript has not caught up with yet. */
    resuming?: boolean
    /** The request is in and no assistant turn exists yet. */
    pending: boolean
    onClientToolOutput?: ClientToolOutputHandler
    onRewind?: (turn: TurnViewModel) => void
}) => (
    <>
        {turns.map((turn, i) => (
            <TurnRow
                key={turn.message.id}
                turn={turn}
                onClientToolOutput={onClientToolOutput}
                onRewind={onRewind}
                sessionId={sessionId}
                remoteRunning={remoteRunning}
                waitingOnUser={waitingOnUser}
                resuming={resuming}
                runId={runIdFor(turns, i)}
                firstTurn={isFirstResponse(turns, i)}
            />
        ))}
        {pending ? (
            <PendingTurn
                sessionId={sessionId}
                runId={runIdFor(turns, turns.length)}
                firstTurn={isFirstResponse(turns, turns.length)}
            />
        ) : null}
    </>
)
