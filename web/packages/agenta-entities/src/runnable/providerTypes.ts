/**
 * Provider Types for Entity Injection
 *
 * Type definitions for the PlaygroundEntityProvider pattern.
 * These types define the interface for dependency injection of entity
 * molecules, allowing OSS and EE to provide different implementations.
 *
 * ## Usage
 *
 * These types are consumed by:
 * - `runnableBridge.ts` for entity-specific features
 * - Playground package for the React context implementation
 *
 * @module runnable/providerTypes
 */

import type {Atom, WritableAtom} from "jotai"

// ============================================================================
// QUERY STATE
// ============================================================================

/**
 * Query state for entity data fetching
 */
export interface EntityQueryState {
    isPending: boolean
    isError: boolean
}

// ============================================================================
// EVALUATOR TYPES
// ============================================================================

/**
 * Settings preset for evaluators
 */
export interface SettingsPreset {
    name: string
    description?: string
    settings_values: Record<string, unknown>
}

// ============================================================================
// SELECTOR INTERFACES
// ============================================================================

/**
 * Interface for entity revision selectors
 */
export interface EntityRevisionSelectors<TData> {
    data: (id: string) => Atom<TData | null>
    query: (id: string) => Atom<EntityQueryState>
    isDirty: (id: string) => Atom<boolean>
}

/**
 * Extended selectors for evaluator revision (has presets)
 */
export interface EvaluatorRevisionSelectors<TData> extends EntityRevisionSelectors<TData> {
    presets: (id: string) => Atom<SettingsPreset[]>
}

/**
 * Actions for evaluator revision
 */
export interface EvaluatorRevisionActions {
    applyPreset: WritableAtom<null, [{revisionId: string; preset: SettingsPreset}], void>
}

// ============================================================================
// APP REVISION LIST INTERFACES
// ============================================================================

/**
 * List selectors for app revision entity hierarchies.
 * Allows the playground controller to query variants/revisions
 * without knowing the concrete data source.
 */
export interface AppRevisionListSelectors {
    /** Variants for an app (includes local draft groups) */
    variantsForApp: (appId: string) => Atom<{data: unknown[] | null}> | undefined
    /** Revisions for a variant */
    revisionsForVariant: (variantId: string) => Atom<unknown[]> | undefined
    /** All revisions for an app (flattened, includes local drafts) */
    allRevisions: (appId: string) => Atom<unknown[]>
    /** Readiness signal — true when initial revision load is complete */
    isReady: Atom<boolean>
}

// ============================================================================
// APP REVISION CRUD INTERFACES
// ============================================================================

export interface AppRevisionCreateVariantPayload {
    baseRevisionId?: string
    baseVariantName?: string
    newVariantName: string
    note?: string
    callback?: (newRevision: {id: string}, state: {selected: string[]}) => void
}

export interface AppRevisionCommitPayload {
    revisionId: string
    note?: string
    commitMessage?: string
    variantId?: string
    parameters?: Record<string, unknown>
}

export interface AppRevisionCrudResult {
    success: boolean
    newRevisionId?: string
    message?: string
    error?: string
}

/**
 * CRUD actions for app revision entities.
 * OSS/EE provides concrete implementations via the provider.
 */
export interface AppRevisionActions {
    createVariant: WritableAtom<
        null,
        [AppRevisionCreateVariantPayload],
        Promise<AppRevisionCrudResult>
    >
    commitRevision: WritableAtom<null, [AppRevisionCommitPayload], Promise<AppRevisionCrudResult>>
    deleteRevision: WritableAtom<null, [string], Promise<AppRevisionCrudResult>>
    invalidateQueries: WritableAtom<null, [], Promise<void>>
}

// ============================================================================
// RAW DATA TYPES
// ============================================================================

/**
 * App revision raw data (as returned by the molecule)
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
        inputs?: Record<string, unknown>
        outputs?: Record<string, unknown>
    }
}

/**
 * Evaluator revision raw data (as returned by the controller)
 */
export interface EvaluatorRevisionRawData {
    id: string
    name?: string
    slug?: string
    version?: number
    configuration?: Record<string, unknown>
    invocationUrl?: string
    evaluatorId?: string
    variantId?: string
    schemas?: {
        inputs?: Record<string, unknown>
        outputs?: Record<string, unknown>
    }
}

// ============================================================================
// PROVIDER INTERFACE
// ============================================================================

/**
 * Injected entity providers
 *
 * This interface defines what entity providers must supply for the
 * playground to work with different entity implementations.
 */
export interface PlaygroundEntityProviders {
    appRevision: {
        selectors: EntityRevisionSelectors<AppRevisionRawData>
        lists?: AppRevisionListSelectors
        actions?: AppRevisionActions
    }
    evaluatorRevision: {
        selectors: EvaluatorRevisionSelectors<EvaluatorRevisionRawData>
        actions: EvaluatorRevisionActions
    }
}
