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

import type {Atom} from "jotai"

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
// APP REVISION CRUD INTERFACES
// ============================================================================

export interface AppRevisionCreateVariantPayload {
    baseRevisionId?: string
    baseVariantName?: string
    newVariantName: string
    slug?: string
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
    errorStatus?: number
}

// ============================================================================
// RAW DATA TYPES
// ============================================================================

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
