/**
 * Whether the composer should replace Send with Stop.
 *
 * A parked approval is still an active run even though the AI SDK is no longer streaming, so the
 * user must retain the same cancellation affordance while the run waits on them.
 */
export const shouldShowStopControl = ({
    busy,
    hitlPending,
}: {
    busy: boolean
    hitlPending: boolean
}): boolean => busy || hitlPending
