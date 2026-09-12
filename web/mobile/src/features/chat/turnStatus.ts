import {deriveRemoteTurnPresentation, type SessionRunStatus} from "@agenta/chat/model"

/** Mobile presentation for a remote/shared-path run. */
export const deriveMobileRemoteTurnPresentation = deriveRemoteTurnPresentation

/**
 * Should the trailing status line show the working pulse?
 *
 * The pulse normally lives inside the streaming turn itself, beside its avatar (`PendingTurn`),
 * which is where the desktop has always had it. That turn cannot cover one case: between the
 * submit and the first assistant part there is no assistant turn to hang it on. The trailing line
 * covers exactly that gap, so the two never render a pulse at the same time.
 */
export const showTrailingWorkingPulse = (
    streaming: boolean,
    turns: {isUser: boolean; isStreamingTurn: boolean}[],
): boolean => streaming && !turns.some((turn) => !turn.isUser && turn.isStreamingTurn)

/**
 * Should this turn carry the working pulse under its content?
 *
 * The turn being generated shows its own loading bubble until it has content, and nothing after
 * that — so reasoning, tool runs and the pauses between paragraphs read as an idle agent for most
 * of a run (#6548). The desktop keeps a working line under the streaming turn for the WHOLE busy
 * period; this is that rule. A parked run (a pending approval) hands the line to the hourglass
 * instead, which the trailing status line renders.
 */
export const showTurnWorkingPulse = (
    turn: {isUser: boolean; isStreamingTurn: boolean; status: {hasContent: boolean}},
    {waitingForInput}: {waitingForInput: boolean},
): boolean => !turn.isUser && turn.isStreamingTurn && turn.status.hasContent && !waitingForInput

export const showRunningElsewhere = ({
    running,
    localStatus,
}: {
    running: boolean
    localStatus: SessionRunStatus
}): boolean => running && localStatus !== "running" && localStatus !== "awaiting"
