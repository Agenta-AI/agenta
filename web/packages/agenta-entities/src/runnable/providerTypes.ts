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
 * Evaluator raw data (as returned by the new evaluator molecule)
 */
export interface EvaluatorRawData {
    id: string
    name?: string | null
    slug?: string | null
    data?: {
        uri?: string | null
        url?: string | null
        parameters?: Record<string, unknown> | null
        schemas?: {
            inputs?: Record<string, unknown> | null
            outputs?: Record<string, unknown> | null
            parameters?: Record<string, unknown> | null
        } | null
    } | null
    flags?: {
        is_custom?: boolean
        is_evaluator?: boolean
        is_feedback?: boolean
        is_chat?: boolean
    } | null
}

/**
 * Workflow raw data (as returned by the workflow molecule)
 */
export interface WorkflowRawData {
    id: string
    name?: string | null
    slug?: string | null
    version?: number | null
    workflow_id?: string | null
    flags?: {
        is_custom?: boolean
        is_evaluator?: boolean
        is_feedback?: boolean
        is_chat?: boolean
    } | null
    data?: {
        uri?: string | null
        url?: string | null
        parameters?: Record<string, unknown> | null
        schemas?: {
            inputs?: Record<string, unknown> | null
            outputs?: Record<string, unknown> | null
            parameters?: Record<string, unknown> | null
        } | null
    } | null
}

// ============================================================================
// PROVIDER INTERFACE
// ============================================================================

/**
 * Selectors for the new evaluator entity
 */
export interface EvaluatorSelectors extends EntityRevisionSelectors<EvaluatorRawData> {
    /** Evaluator URI (e.g., "agenta:builtin:auto_exact_match:v0") */
    uri?: (id: string) => Atom<string | null>
    /** Evaluator key parsed from URI */
    evaluatorKey?: (id: string) => Atom<string | null>
    /** Configuration parameters */
    parameters?: (id: string) => Atom<Record<string, unknown> | null>
    /** Is custom evaluator */
    isCustom?: (id: string) => Atom<boolean>
}

/**
 * Injected entity providers
 *
 * This interface defines what entity providers must supply for the
 * playground to work with different entity implementations.
 */
export interface PlaygroundEntityProviders {
    /** Workflow entity (modern /workflows/ API, handles both apps and evaluators via flags) */
    workflow?: {
        selectors: EntityRevisionSelectors<WorkflowRawData>
    }
}
