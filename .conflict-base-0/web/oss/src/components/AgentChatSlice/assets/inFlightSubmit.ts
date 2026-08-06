export interface InFlightSubmitRef {
    current: boolean
}

/** Admit one async submit at a time and always release the guard when it settles. */
export async function runWithInFlightSubmit<T>(
    inFlight: InFlightSubmitRef,
    task: () => Promise<T>,
): Promise<T | undefined> {
    if (inFlight.current) return undefined
    inFlight.current = true
    try {
        return await task()
    } finally {
        inFlight.current = false
    }
}
