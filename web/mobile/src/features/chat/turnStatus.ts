import {deriveRemoteTurnPresentation} from "@agenta/chat/model"
import {runKey} from "@agenta/chat/state"

/** Mobile presentation for a remote/shared-path run. */
export const deriveMobileRemoteTurnPresentation = deriveRemoteTurnPresentation

/** Should a placeholder turn wear the working line? Only after a user turn: the flag drops between steps. */
export const showTrailingWorkingPulse = (streaming: boolean, turns: {isUser: boolean}[]): boolean =>
    streaming && (turns.length === 0 || turns[turns.length - 1].isUser)

interface RunTurn {
    isUser: boolean
    message: {id: string; metadata?: unknown}
}

/** The user message that opened the run of the turn at `index` (the placeholder is index = length). */
const openingUserTurn = (turns: RunTurn[], index: number): RunTurn | undefined => {
    for (let i = Math.min(index, turns.length) - 1; i >= 0; i--)
        if (turns[i].isUser) return turns[i]
    return undefined
}

/** The run key for the turn at `index`: the user message that started it. */
export const runIdFor = (turns: RunTurn[], index: number): string | undefined => {
    const opener = openingUserTurn(turns, index)
    return opener ? runKey(opener.message.id) : undefined
}

/** When the server saved the user message that started the turn at `index`, if it is saved. */
export const runStartedAtFor = (turns: RunTurn[], index: number): number | undefined => {
    const at = (
        openingUserTurn(turns, index)?.message.metadata as {createdAt?: unknown} | undefined
    )?.createdAt
    return typeof at === "number" ? at : undefined
}
