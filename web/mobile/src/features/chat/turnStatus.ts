import {deriveRemoteTurnPresentation, type SessionRunStatus} from "@agenta/chat/model"
import {runKey} from "@agenta/chat/state"

/** Mobile presentation for a remote/shared-path run. */
export const deriveMobileRemoteTurnPresentation = deriveRemoteTurnPresentation

/**
 * Should a placeholder turn wear the working line?
 *
 * The line lives on the assistant turn itself. That turn cannot cover one case: between the submit
 * and the first assistant part there is no assistant turn to hang it on, so a placeholder stands
 * in. Keyed on the LAST turn being the user's, not on any turn being flagged streaming: the flag
 * drops between the steps of a run, and a placeholder under a turn that is still live read as a
 * second, empty turn.
 */
export const showTrailingWorkingPulse = (streaming: boolean, turns: {isUser: boolean}[]): boolean =>
    streaming && (turns.length === 0 || turns[turns.length - 1].isUser)

/**
 * The clock key for the turn at `index`: the user message that started its run. The placeholder
 * turn (index = length) and the assistant turn that replaces it share it, so the count the
 * placeholder began carries on instead of restarting at zero.
 */
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

/**
 * Whether the turn at `index` is the session's first response — the one that boots the agent
 * and narrates its startup. The placeholder turn (index = length) counts the same way.
 */
export const isFirstResponse = (turns: {isUser: boolean}[], index: number): boolean =>
    !turns.slice(0, Math.min(index, turns.length)).some((turn) => !turn.isUser)
