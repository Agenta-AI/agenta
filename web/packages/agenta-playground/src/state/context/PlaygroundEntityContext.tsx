/**
 * PlaygroundEntityContext
 *
 * Dependency injection context for entity molecule providers.
 *
 * ## Purpose
 *
 * This context enables runtime injection of entity implementations, allowing:
 * - OSS and EE to provide different molecule implementations
 * - Clean separation between feature code (playground) and entity specifics
 * - Testing with mock providers
 *
 * ## Architecture
 *
 * The context works alongside the static bridge pattern:
 * - **Bridge** (static): Default configuration at build time (`runnableBridge`)
 * - **Context** (runtime): Optional override for custom implementations
 *
 * When no context is provided, hooks fall back to the default bridge selectors.
 *
 * ## Usage
 *
 * 1. App wraps with `PlaygroundEntityProvider`, passing entity modules
 * 2. Feature code uses `usePlaygroundEntities()` to access injected modules
 * 3. Alternatively, use `runnableBridge` directly for static configuration
 *
 * @example
 * ```tsx
 * // In OSS app wrapper
 * <PlaygroundEntityProvider
 *   providers={{
 *     appRevision: {
 *       selectors: {
 *         data: appRevisionMolecule.selectors.data,
 *         query: appRevisionMolecule.selectors.query,
 *         isDirty: appRevisionMolecule.selectors.isDirty,
 *       },
 *     },
 *     evaluatorRevision: {
 *       selectors: {
 *         data: evaluatorRevision.selectors.data,
 *         query: evaluatorRevision.selectors.query,
 *         isDirty: evaluatorRevision.selectors.isDirty,
 *         presets: evaluatorRevision.selectors.presets,
 *       },
 *       actions: {
 *         applyPreset: evaluatorRevision.actions.applyPreset,
 *       },
 *     },
 *   }}
 * >
 *   <App />
 * </PlaygroundEntityProvider>
 * ```
 */

import {createContext, useContext, type ReactNode} from "react"

import type {PlaygroundEntityProviders} from "@agenta/entities/runnable"

// Re-export types for convenience
export type {
    PlaygroundEntityProviders,
    EntityRevisionSelectors,
    EvaluatorRevisionSelectors,
    EvaluatorRevisionActions,
    EntityQueryState,
    SettingsPreset,
    AppRevisionRawData,
    EvaluatorRevisionRawData,
} from "@agenta/entities/runnable"

// ============================================================================
// CONTEXT
// ============================================================================

const PlaygroundEntityContext = createContext<PlaygroundEntityProviders | null>(null)

/**
 * Provider for injecting entity modules into the playground
 */
export function PlaygroundEntityProvider({
    children,
    providers,
}: {
    children: ReactNode
    providers: PlaygroundEntityProviders
}) {
    return (
        <PlaygroundEntityContext.Provider value={providers}>
            {children}
        </PlaygroundEntityContext.Provider>
    )
}

/**
 * Hook to access injected entity modules
 *
 * @throws Error if used outside of PlaygroundEntityProvider
 *
 * @example
 * ```tsx
 * function RunnableSelector() {
 *   const { appRevision, evaluatorRevision } = usePlaygroundEntities()
 *
 *   const appData = useAtomValue(appRevision.selectors.data(revisionId))
 *   const evalData = useAtomValue(evaluatorRevision.selectors.data(evalId))
 *
 *   return <div>...</div>
 * }
 * ```
 */
export function usePlaygroundEntities(): PlaygroundEntityProviders {
    const ctx = useContext(PlaygroundEntityContext)
    if (!ctx) {
        throw new Error("usePlaygroundEntities must be used within PlaygroundEntityProvider")
    }
    return ctx
}

/**
 * Hook to check if playground entities are available
 * (for optional features that work without the provider)
 */
export function usePlaygroundEntitiesOptional(): PlaygroundEntityProviders | null {
    return useContext(PlaygroundEntityContext)
}
