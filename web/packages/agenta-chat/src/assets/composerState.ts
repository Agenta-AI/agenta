/** A parked approval remains stoppable after streaming pauses. */
export const shouldShowStopControl = ({
    busy,
    hitlPending,
}: {
    busy: boolean
    hitlPending: boolean
}): boolean => busy || hitlPending
