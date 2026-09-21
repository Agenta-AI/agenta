import {deriveRemoteTurnPresentation, type SessionRunStatus} from "@agenta/chat/model"
import {runKey} from "@agenta/chat/state"

/** Mobile presentation for a remote/shared-path run. */
export const deriveMobileRemoteTurnPresentation = deriveRemoteTurnPresentation

/** Should a placeholder turn wear the working line? Only after a user turn: the flag drops between steps. */
export const showTrailingWorkingPulse = (streaming: boolean, turns: {isUser: boolean}[]): boolean =>
    streaming && (turns.length === 0 || turns[turns.length - 1].isUser)

/** The run key for the turn at `index`: the user message that started it (the placeholder is index = length). */
export const runIdFor = (
    turns: {isUser: boolean; message: {id: string}}[],
    index: number,
): string | undefined => {
    for (let i = Math.min(index, turns.length) - 1; i >= 0; i--) {
        if (turns[i].isUser) return runKey(turns[i].message.id)
    }
    return undefined
}

export const showRunningElsewhere = ({
    running,
    localStatus,
}: {
    running: boolean
    localStatus: SessionRunStatus
}): boolean => running && localStatus !== "running" && localStatus !== "awaiting"

/** Whether the turn at `index` is the session's first response, the one that boots the agent. */
export const isFirstResponse = (turns: {isUser: boolean}[], index: number): boolean =>
    !turns.slice(0, Math.min(index, turns.length)).some((turn) => !turn.isUser)
