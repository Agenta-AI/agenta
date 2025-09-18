/**
 * Strict Type Definitions for Playground Atoms
 *
 * This file provides comprehensive type safety for the new atom-based
 * playground state management system.
 */

import type {Enhanced, Common, Merge} from "@/oss/lib/shared/variant/genericTransformer/types"
import type {EnhancedVariant, Message, TestResult} from "@/oss/lib/shared/variant/transformer/types"

import type {ViewType} from "../hooks/usePlayground/types"

// Re-export commonly used types
export type {ViewType, EnhancedVariant}

/**
 * CORE STATE TYPES
 */

// Config value type for variant properties - supports both simple and complex values
export type ConfigValue =
    | string
    | number
    | boolean
    | string[]
    | null
    | Record<string, any> // Support for complex objects like {type: "json_schema", json_schema: {...}}
    | any[] // Support for arrays of complex objects

// Message types with proper inheritance
export type MessageWithId = Merge<Common, Message>

export interface WithRuns {
    __runs?: Record<
        string,
        | {
              __isRunning?: string
              __result?: TestResult | string | null
              __id?: string
              message?: Enhanced<MessageWithId> | Enhanced<MessageWithId>[]
          }
        | undefined
    >
    message?: MessageWithId
    __result?: TestResult | string | null
    __isRunning?: string
}

export type MessageWithRuns = Merge<WithRuns, MessageWithId>

// Test row structure
export interface TestRow extends WithRuns {
    __id: string
    [key: string]: any // Allow additional dynamic properties
}

// Message row structure for chat
export interface MessageRow {
    __id: string
    history: Enhanced<MessageWithRuns[]>
}

// Generation data structure
export interface GenerationData {
    inputs: Enhanced<TestRow[]>
    messages: Enhanced<MessageRow[]>
}

// Test run state for tracking execution
export interface TestRunState {
    __isRunning: string
    __result: string
    __error?: string
}

// Core playground state
export interface PlaygroundState {
    generationData: GenerationData
    metadata: Record<string, any>
}

/**
 * VARIANT TYPES
 */

// Enhanced property with strict typing
export interface EnhancedProperty {
    value: ConfigValue
    __id: string
    __metadata: PropertyMetadata
    handleChange?: (value: ConfigValue) => void
}

// Property metadata with strict options
export interface PropertyMetadata {
    type: "string" | "number" | "boolean" | "array" | "compound"
    title?: string
    description?: string
    min?: number
    max?: number
    nullable?: boolean
    options?: CompoundOption[]
    itemMetadata?: {
        type: string
        properties: Record<string, unknown>
    }
}

export interface CompoundOption {
    label: string
    value: string
    config: {
        type: string
        schema?: Record<string, unknown>
        [key: string]: unknown
    }
}

/**
 * MUTATION TYPES
 */

// Variant update parameters
export interface VariantUpdateParams {
    variantId: string
    propertyId: string
    value: ConfigValue
}

// Bulk variant mutation parameters
export interface VariantMutationParams {
    variantId: string
    updates: Partial<EnhancedVariant> | ((variant: EnhancedVariant) => Partial<EnhancedVariant>)
}

// Optimistic update parameters
export interface OptimisticVariantUpdate {
    variantId: string
    changes: Partial<EnhancedVariant>
}

// Variant CRUD result
export interface VariantCrudResult {
    success: boolean
    variant?: EnhancedVariant
    message?: string
    error?: string
}

// Add variant parameters
export interface AddVariantParams {
    baseVariantName: string
    // Optional explicit base revision id; when omitted, code derives from baseVariantName's newest revision
    revisionId?: string
    newVariantName: string
    note?: string
    commitType?: "prompt" | "parameters"
    callback?: (variant: EnhancedVariant, state: PlaygroundState) => void
}

// Save variant parameters
export interface SaveVariantParams {
    variantId: string
    note?: string
    commitType?: "prompt" | "parameters"
    callback?: (variant: EnhancedVariant) => void
}

// Delete variant parameters
export interface DeleteVariantParams {
    variantId: string
    callback?: () => void
}

// Enhanced mutation parameters
export interface EnhancedVariantPropertyMutationParams {
    variantId: string | {id: string} // Can be string ID or object with id
    propertyId: string
    value: ConfigValue
    rowId?: string // For generation data updates
}

// Test execution parameters
export interface RunTestsParams {
    variantIds: string[]
    inputs: any[]
    testConfig?: any
}

export interface CancelTestsParams {
    rowId?: string
    variantId?: string
    variantIds?: string[]
    reason?: string
}

export interface RerunChatParams {
    messageId: string
    variantId?: string
}

/**
 * LOADABLE TYPES
 */

// Loadable state wrapper
export interface LoadableState<T> {
    state: "loading" | "hasData" | "hasError"
    data?: T
    error?: Error
}

/**
 * WEB WORKER TYPES
 */

export type WorkerStatus = "idle" | "working"

export interface WorkerMessage<T = any> {
    type: string
    payload: T
}

// Serializable state for web worker
export interface SerializablePlaygroundState {
    variants: Omit<EnhancedVariant, "__metadata" | "handleChange">[]
    selected: string[]
    generationData: GenerationData
}

/**
 * HOOK TYPES
 */

// Options for usePlaygroundAtoms hook
export interface UsePlaygroundAtomsOptions {
    enableOptimisticUpdates?: boolean
    enableWebWorker?: boolean
    preloadRevisions?: boolean
    preloadUserProfiles?: boolean
}

// Return type for usePlaygroundAtoms hook
export interface UsePlaygroundAtomsReturn {
    // State selectors
    variants: EnhancedVariant[]
    selectedVariants: string[]
    displayedVariants: EnhancedVariant[]
    currentVariant?: EnhancedVariant
    viewType: ViewType
    generationData: GenerationData
    testRunStates: Record<string, Record<string, TestRunState>>

    // Dirty state
    isAnyVariantDirty: boolean
    dirtyVariantIds: string[]
    isVariantDirty: (variantId: string) => boolean

    // UI mutations
    setSelectedVariant: (variantId: string) => void
    toggleVariantDisplay: (variantId: string) => void
    setDisplayedVariants: (variantIds: string[]) => void

    // Variant mutations
    updateVariantProperty: (params: VariantUpdateParams) => void
    updateVariantPropertyEnhanced: (params: EnhancedVariantPropertyMutationParams) => void
    mutateVariant: (params: VariantMutationParams) => void
    handleParamUpdate: (e: {target: {value: any}} | any, propId?: string, vId?: string) => void

    // Variant CRUD operations
    addVariant: (params: AddVariantParams) => Promise<VariantCrudResult>
    saveVariant: (params: SaveVariantParams) => Promise<VariantCrudResult>
    deleteVariant: (params: DeleteVariantParams) => Promise<VariantCrudResult>
    runTests?: (rowId?: string, variantId?: string) => void
    cancelRunTests?: (rowId?: string, variantId?: string) => void
    rerunChatOutput?: (messageId: string, variantId?: string) => void
    clearTestResults?: (params: {rowId?: string; variantId?: string}) => void

    // Property access
    variantConfig?: Enhanced<any>
    variantConfigProperty?: EnhancedProperty
    propertyGetter?: (propertyId: string) => EnhancedProperty | undefined
    selectedData?: any // TODO: Define proper Selected type

    // Web worker
    handleWebWorkerMessage?: (message: WorkerMessage) => void
}

/**
 * ATOM FAMILY PARAMETER TYPES
 */

// Parameters for variant property atom family
export interface VariantPropertyParams {
    variantId: string
    propertyId: string
}

// Parameters for variant revision loadable family
export interface VariantRevisionParams {
    variantId: string
}

/**
 * ERROR TYPES
 */

export class PlaygroundError extends Error {
    constructor(
        message: string,
        public code: string,
        public context?: Record<string, any>,
    ) {
        super(message)
        this.name = "PlaygroundError"
    }
}

export class VariantNotFoundError extends PlaygroundError {
    constructor(variantId: string) {
        super(`Variant not found: ${variantId}`, "VARIANT_NOT_FOUND", {variantId})
    }
}

export class PropertyNotFoundError extends PlaygroundError {
    constructor(propertyId: string, variantId: string) {
        super(`Property not found: ${propertyId} in variant ${variantId}`, "PROPERTY_NOT_FOUND", {
            propertyId,
            variantId,
        })
    }
}

/**
 * TYPE GUARDS
 */

export function isConfigValue(value: unknown): value is ConfigValue {
    return (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value) ||
        value === null
    )
}

export function isEnhancedVariant(value: unknown): value is EnhancedVariant {
    return typeof value === "object" && value !== null && "id" in value && "variantName" in value
}

export function isLoadableState<T>(value: unknown): value is LoadableState<T> {
    return (
        typeof value === "object" &&
        value !== null &&
        "state" in value &&
        ["loading", "hasData", "hasError"].includes((value as any).state)
    )
}
