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
