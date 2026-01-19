/**
 * Playground Entity Context Types
 *
 * Type definitions for entity providers used by runnable hooks.
 * These types define the interface for accessing entity molecules.
 */

import type {Atom, WritableAtom} from "jotai"

// ============================================================================
// ENTITY SELECTOR TYPES
// ============================================================================

/**
 * Query state returned by entity queries
 */
export interface EntityQueryState<T = unknown> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: unknown
}

/**
 * Settings preset for evaluators
 */
export interface SettingsPreset {
    id: string
    name: string
    description?: string
    settings: Record<string, unknown>
}

/**
 * Selectors for app revision entities
 */
export interface EntityRevisionSelectors {
    /** Get entity data by ID */
    data: (id: string) => Atom<unknown | null>
    /** Get query state by ID */
    query: (id: string) => Atom<EntityQueryState>
    /** Check if entity has unsaved changes */
    isDirty: (id: string) => Atom<boolean>
}

/**
 * Selectors for evaluator revision entities
 */
export interface EvaluatorRevisionSelectors extends EntityRevisionSelectors {
    /** Get available presets for an evaluator */
    presets: (id: string) => Atom<SettingsPreset[]>
}

/**
 * Actions for evaluator revision entities
 */
export interface EvaluatorRevisionActions {
    /** Apply a preset to an evaluator */
    applyPreset: WritableAtom<null, [evaluatorId: string, presetId: string], void>
}

// ============================================================================
// PROVIDER TYPES
// ============================================================================

/**
 * App revision raw data shape
 */
export interface AppRevisionRawData {
    id: string
    name?: string
    variantSlug?: string
    version?: number
    configuration?: Record<string, unknown>
    invocationUrl?: string
    appId?: string
    variantId?: string
    schemas?: {
        inputSchema?: unknown
        outputSchema?: unknown
    }
}

/**
 * Evaluator revision raw data shape
 */
export interface EvaluatorRevisionRawData {
    id: string
    name?: string
    slug?: string
    version?: number
    configuration?: Record<string, unknown>
    invocationUrl?: string
    schemas?: {
        inputSchema?: unknown
        outputSchema?: unknown
    }
}

/**
 * Entity providers interface
 *
 * Defines the selectors and actions available for each entity type.
 * Used by runnable hooks to access entity data.
 */
export interface PlaygroundEntityProviders {
    appRevision: {
        selectors: EntityRevisionSelectors
    }
    evaluatorRevision: {
        selectors: EvaluatorRevisionSelectors
        actions: EvaluatorRevisionActions
    }
}

// ============================================================================
// CONTEXT (optional - for dependency injection)
// ============================================================================

import {createContext, useContext, type ReactNode} from "react"

const PlaygroundEntityContext = createContext<PlaygroundEntityProviders | null>(null)

/**
 * Provider for entity molecules
 *
 * @example
 * ```tsx
 * <PlaygroundEntityProvider value={providers}>
 *   <PlaygroundContent />
 * </PlaygroundEntityProvider>
 * ```
 */
export function PlaygroundEntityProvider({
    children,
    value,
}: {
    children: ReactNode
    value: PlaygroundEntityProviders
}) {
    return <PlaygroundEntityContext.Provider value={value}>{children}</PlaygroundEntityContext.Provider>
}

/**
 * Get entity providers from context
 *
 * @throws If used outside of PlaygroundEntityProvider
 */
export function usePlaygroundEntities(): PlaygroundEntityProviders {
    const ctx = useContext(PlaygroundEntityContext)
    if (!ctx) {
        throw new Error("usePlaygroundEntities must be used within PlaygroundEntityProvider")
    }
    return ctx
}

/**
 * Get entity providers from context (optional)
 *
 * @returns Providers if available, null otherwise
 */
export function usePlaygroundEntitiesOptional(): PlaygroundEntityProviders | null {
    return useContext(PlaygroundEntityContext)
}
