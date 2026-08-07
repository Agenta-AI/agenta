import {useMemo} from "react"

import {buildTurnViewModels, createExecutedToolIdentityCache} from "@agenta/chat/model"

import {ChatHeader} from "./ChatHeader"
import {ChatEmpty, ChatLoading} from "./states/ChatStates"
import {TurnRow} from "./TurnRow"
import {useSessionTranscript} from "./useSessionTranscript"

/** Read-only replay screen — mount it with `key={sessionId}` so per-session state resets. */
export const ChatScreen = ({
    sessionId,
    projectId,
    workspaceId,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
}) => {
    const {messages, state} = useSessionTranscript(sessionId)
    // One identity cache per session mount (the screen is keyed by sessionId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const executedFor = useMemo(() => createExecutedToolIdentityCache(), [sessionId])
    const turns = useMemo(
        () => buildTurnViewModels(messages, {busy: false, executedFor}),
        [messages, executedFor],
    )

    let body
    if (state === "loading") {
        body = <ChatLoading />
    } else if (state === "empty") {
        body = <ChatEmpty />
    } else {
        body = (
            <div className="flex grow flex-col gap-3 p-4">
                {turns
                    .filter((turn) => !turn.hidden)
                    .map((turn) => (
                        <TurnRow key={turn.message.id} turn={turn} />
                    ))}
            </div>
        )
    }

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col">
            <ChatHeader sessionId={sessionId} projectId={projectId} workspaceId={workspaceId} />
            {body}
        </div>
    )
}
