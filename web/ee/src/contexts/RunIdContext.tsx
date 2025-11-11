import React, {createContext, useContext} from "react"

/**
 * Context for providing the current evaluation run ID to components.
 * This enables components to use run-scoped atoms without prop drilling.
 */
export const RunIdContext = createContext<string | null>(null)

/**
 * Provider component that supplies the run ID to all child components.
 */
export const RunIdProvider: React.FC<{
    runId: string
    children: React.ReactNode
}> = ({runId, children}) => {
    return <RunIdContext.Provider value={runId}>{children}</RunIdContext.Provider>
}

/**
 * Hook to access the current run ID from context.
 * Throws an error if used outside of a RunIdProvider.
 */
export const useRunId = (): string => {
    const runId = useContext(RunIdContext)
    if (!runId) {
        throw new Error(
            "useRunId must be used within a RunIdProvider. " +
                "Make sure your component is wrapped with <RunIdProvider runId={...}>",
        )
    }
    return runId
}

/**
 * Hook to safely access the run ID, returning null if not available.
 * Useful for components that can work with or without a run ID.
 */
export const useOptionalRunId = (): string | null => {
    return useContext(RunIdContext)
}
