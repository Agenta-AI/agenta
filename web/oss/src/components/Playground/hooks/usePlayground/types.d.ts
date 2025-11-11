import type {Map} from "immutable"
import type {SWRConfiguration, SWRResponse, SWRHook, MutatorOptions} from "swr"

import type {Enhanced} from "../../../../lib/shared/variant/genericTransformer/types"
import type {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
import {InitialStateType} from "../../state/types"

import type {AgentaFetcher, FetcherOptions} from "@/lib/api/types"

/** Base hook configuration types */
interface BaseHookConfig<T = unknown, _Selected = unknown>
    extends Omit<SWRConfiguration<T, Error>, "compare" | "fetcher"> {
    hookId?: string
    projectId?: string
    cache?: Map<string, {data: T}>
    registerToWebWorker?: boolean
    compare?: (a: T | undefined, b: T | undefined) => boolean
    fetcher?: AgentaFetcher
}

/** Base hook response extending SWR */
interface BaseHookResponse<T = unknown, Selected = unknown> extends SWRResponse<T, Error> {
    isDirty?: boolean
    selectedData?: Selected
    mutate: CustomKeyedMutator<T>
}

/** Generic selector types */
interface SelectorConfig<T = any, Selected = unknown> {
    variantSelector?: (variant: EnhancedVariant) => Selected
    stateSelector?: (state: T) => Selected
}

// Base state shape
export interface PlaygroundStateData extends InitialStateType {
    dataRef?: Record<string, string>
    [key: string]: any
}

// Playground specific config
export interface PlaygroundSWRConfig<T = PlaygroundStateData, Selected = unknown>
    extends BaseHookConfig<T, Selected>,
        SelectorConfig<T, Selected> {
    variantId?: string
    propertyId?: string
    skipBackgroundLoading?: boolean
}

// Each middleware extends this to add its own properties
export interface PlaygroundResponse<T = PlaygroundStateData, Selected = unknown>
    extends SWRResponse<T, Error> {
    isDirty?: boolean
    mutate: CustomKeyedMutator<T>
    selectedData?: Selected
    propertyGetter?: (propertyId: string) => EnhancedProperty
    handleWebWorkerMessage?: (message: WorkerMessage<T>) => void
}

// Variants middleware extensions
export interface PlaygroundVariantsResponse extends PlaygroundResponse {
    variants?: EnhancedVariant[]
    variantIds?: string[]
    addVariant?: (options: {
        baseVariantName: string
        newVariantName: string
        note?: string
        commitType?: "prompt" | "parameters"
        callback?: (variant: EnhancedVariant, state: PlaygroundStateData) => void
    }) => void
    runTests?: (rowId?: string, variantId?: string) => void
    cancelRunTests?: (rowId?: string, variantId?: string) => void
    rerunChatOutput?: (messageId: string, variantId?: string) => void
}

export type VariantUpdateFunction<T extends EnhancedVariant = EnhancedVariant> = (
    state: T,
) => Partial<EnhancedVariant> | undefined

// Single variant middleware extensions
export interface PlaygroundVariantResponse<_T extends PlaygroundStateData = PlaygroundStateData>
    extends PlaygroundVariantsResponse {
    variant?: EnhancedVariant
    displayedVariants?: string[]
    deleteVariant?: () => Promise<void>
    mutateVariant?: (updates: Partial<EnhancedVariant> | VariantUpdateFunction) => Promise<void>
    saveVariant?: (
        note?: string,
        commitType?: "prompt" | "parameters",
        callback?: (variant: EnhancedVariant) => void,
    ) => Promise<void>
    setSelectedVariant?: (variantId: string) => void
    handleParamUpdate?: (value: any, propertyId: string, variantId?: string) => void
    variantConfig?: Enhanced<any>
    variantConfigProperty?: EnhancedProperty
}

// Hook options extending SWR config
export interface UsePlaygroundStateOptions<
    _T extends PlaygroundStateData = PlaygroundStateData,
    Selected = unknown,
> extends PlaygroundSWRConfig<_T, Selected> {
    appId?: string
    appType?: string
    hookId?: string
    debug?: boolean
    withVariants?: boolean
    trackIsDirty?: boolean
    cache?: Map<string, {data: T}>
}

// Custom SWR configuration with generic Selected type
export interface PlaygroundSWRConfig<
    T extends PlaygroundStateData = PlaygroundStateData,
    Selected = unknown,
> extends Omit<SWRConfiguration<T, Error>, "compare" | "fetcher"> {
    compare?: (a: T | undefined, b: T | undefined) => boolean
    fetcher?: AgentaFetcher
    appType?: string
    variantId?: string
    rowId?: string
    hookId?: string
    projectId?: string
    pathReference?: string
    appId?: string
    cache?: Map<string, {data: T}>
    variantSelector?: VariantSelector<Selected>
    stateSelector?: StateSelector<Selected>
    propertyId?: string
}

// Generic selector types
export type VariantSelector<T = any> = (variant: EnhancedVariant) => T
export type StateSelector<T = any> = (state: PlaygroundStateData) => T

export interface PlaygroundMiddlewareParams<T extends PlaygroundStateData = PlaygroundStateData> {
    key: string | Key
    fetcher: ((url: string, options?: FetcherOptions) => Promise<T>) | null
    config: PlaygroundSWRConfig<T>
}

// Update the base middleware type to match SWR's Middleware structure with proper constraints
export type PlaygroundMiddleware = <
    Data extends PlaygroundStateData = PlaygroundStateData,
    Selected = unknown,
>(
    useSWRNext: SWRHook,
) => (
    key: Key,
    fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
    config: PlaygroundSWRConfig<Data, Selected>,
) => PlaygroundResponse<Data, Selected>

// Final hook return type combining base responses with selected data
export type UsePlaygroundReturn<Selected = unknown> = PlaygroundVariantResponse &
    PlaygroundResponse<PlaygroundStateData, Selected> &
    UIState<PlaygroundStateData, Selected> &
    Selected

// Property control types
export interface CompoundOption {
    label: string
    value: string
    config: {
        type: string
        schema?: Record<string, unknown>
        [key: string]: unknown
    }
}

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

export interface EnhancedProperty {
    value: any
    __id: string
    __metadata: PropertyMetadata
    handleChange: (value: any) => void
}

export type ViewType = "single" | "comparison"

export interface UIState<Data extends PlaygroundStateData = PlaygroundStateData, Selected = unknown>
    extends PlaygroundResponse<Data, Selected> {
    displayedVariants?: string[]
    viewType?: ViewType
    setSelectedVariant?: (variantId: string) => void
    toggleVariantDisplay?: (variantId: string, display?: boolean) => void
    setDisplayedVariants?: (variantIds: string[]) => void
}

export type MutateFunction<T extends PlaygroundStateData = PlaygroundStateData> = (
    state: T,
) => T | Promise<T | undefined> | undefined

interface CustomMutateOptions extends MutatorOptions {
    revalidate?: boolean
    variantId?: string
}

type CustomKeyedMutator<Data extends PlaygroundStateData> = (
    data: Data | MutateFunction<Data>,
    options?: CustomMutateOptions,
) => Promise<Data | undefined>
