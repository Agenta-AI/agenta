/**
 * PlaygroundContent hooks
 *
 * usePlaygroundState and useDerivedState moved to @agenta/playground/react
 */

// Re-export from @agenta/playground/react for backwards compatibility
export {
    usePlaygroundState,
    useDerivedState,
    type DerivedStateParams,
} from "@agenta/playground/react"

// Component-specific hooks (stay here due to framework dependencies like next/router)
export {useTestsetHandlers, type TestsetHandlersParams} from "./useTestsetHandlers"
