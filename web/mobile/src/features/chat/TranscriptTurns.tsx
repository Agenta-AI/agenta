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
    pending,
    onClientToolOutput,
    onRewind,
}: {
    turns: TurnViewModel[]
    sessionId: string
    remoteRunning: boolean
    waitingOnUser: boolean
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
