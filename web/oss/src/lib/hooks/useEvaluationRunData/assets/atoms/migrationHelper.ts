/**
 * Migration helper for gradual transition from global atoms to run-scoped atoms
 *
 * This provides compatibility layers that allow existing components to work
 * while we gradually migrate them to use the new run-scoped atom families.
 */

// Current active run ID - this is a temporary bridge during migration
let currentRunId: string | null = null

export const getCurrentRunId = (): string => {
    if (!currentRunId) {
        throw new Error(
            "No current run ID set. Make sure to call setCurrentRunId() before using legacy atoms.",
        )
    }
    return currentRunId
}
