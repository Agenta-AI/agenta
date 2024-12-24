import {Map} from "immutable"
import {SWRConfiguration, SWRResponse} from "swr"
import {StateVariant} from "../../state/types"
import {Variant} from "@/lib/Types"
import {type SWRHook} from "swr"
import {type AgentaFetcher, type FetcherOptions} from "@/lib/api/types"

export type {Variant}
// Base state shape
export interface PlaygroundStateData {
    variants: StateVariant[]
    dirtyStates?: Map<string, boolean>
    dataRef?: Map<string, StateVariant>
    [key: string]: any
}

// Each middleware extends this to add its own properties
export interface PlaygroundResponse<T = PlaygroundStateData, Selected = any>
    extends SWRResponse<T, Error> {
    isDirty?: boolean
    selectedData?: Selected
}

// Variants middleware extensions
export interface PlaygroundVariantsResponse extends PlaygroundResponse {
    variants?: StateVariant[]
    variantIds?: string[]
    addVariant?: (options: {baseVariantName: string; newVariantName: string}) => void
}

export interface VariantUpdateFunction<T extends PlaygroundStateData = PlaygroundStateData> {
    (state: T): Partial<StateVariant> | undefined
}

// Single variant middleware extensions
export interface PlaygroundVariantResponse<T extends PlaygroundStateData = PlaygroundStateData>
    extends PlaygroundVariantsResponse {
    variant?: StateVariant
    deleteVariant?: () => Promise<void>
    mutateVariant?: (updates: Partial<StateVariant> | VariantUpdateFunction<T>) => Promise<void>
    saveVariant?: () => Promise<void>
    variantConfig?: any // TODO: Type this properly based on your schema
    variantConfigProperty?: {
        property?: {
            config: any // TODO: Type this properly
            valueInfo: any // TODO: Type this properly
            handleChange: (e: any) => void // TODO: Type this properly
        }
    }
}

// Hook options extending SWR config
export interface UsePlaygroundStateOptions<
    T extends PlaygroundStateData = PlaygroundStateData,
    E = Error,
> extends PlaygroundSWRConfig<T> {
    appId?: string
    hookId?: string
    debug?: boolean
    withVariants?: boolean
    trackIsDirty?: boolean
    cache?: Map<string, {data: T}>
}

// Custom SWR configuration that allows undefined in compare function
export interface PlaygroundSWRConfig<T extends PlaygroundStateData = PlaygroundStateData, S = any>
    extends Omit<SWRConfiguration<T, Error>, "compare" | "fetcher"> {
    compare?: (a: T | undefined, b: T | undefined) => boolean // Changed to always return boolean
    fetcher?: AgentaFetcher
    variantId?: string
    hookId?: string
    projectId?: string
    service?: string
    configKey?: keyof StateVariant
    valueKey?: keyof StateVariant
    cache?: Map<string, {data: T}> // Add this line
    variantSelector?: VariantSelector<S> // Add this line
    stateSelector?: StateSelector<S> // Add this line
}

// Selector types
export type VariantSelector<T = any> = (variant: StateVariant) => T
export type StateSelector<T = any> = (state: PlaygroundStateData) => T

export interface PlaygroundMiddlewareParams<T extends PlaygroundStateData = PlaygroundStateData> {
    key: string | Key
    fetcher: ((url: string, options?: FetcherOptions) => Promise<T>) | null
    config: PlaygroundSWRConfig<T>
}

// Update the base middleware type to match SWR's Middleware structure with proper constraints
export type PlaygroundMiddleware = {
    (
        useSWRNext: SWRHook,
    ): <Data extends PlaygroundStateData = PlaygroundStateData, S = any>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data, S>,
    ) => PlaygroundResponse<Data, S>
}

// Final hook return type combining all middleware responses
export type UsePlaygroundReturn = PlaygroundVariantResponse & PlaygroundResponse

// Response type will infer the selected type from the selector's return type
export type InferSelectedData<T> = T extends PlaygroundSWRConfig & {
    stateSelector?: (state: PlaygroundStateData) => infer R
}
    ? R
    : T extends PlaygroundSWRConfig & {
            variantSelector?: (variant: StateVariant) => infer R
        }
      ? R
      : never
