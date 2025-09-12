/**
 * Unified Playground Hook
 * Now exclusively uses the Jotai atom-based system after successful migration
 * Provides a clean interface for playground state management
 */

import {getPlaygroundFeatureFlags} from "../../config/featureFlags"

/**
 * Unified hook interface that works with both systems
 * Provides backward compatibility while enabling new features
 */
export interface UnifiedPlaygroundHook {
    // Core state
    data: any
    isLoading: boolean
    error: Error | null

    // Variant management
    variant?: any
    variants?: any[]
    selectedVariants?: string[]
    currentVariant?: any

    // UI state
    viewType?: "single" | "compare"
    isRunning?: boolean
    resultHashes?: string[]

    // Mutations
    updateVariantProperty?: (params: any) => void
    addVariant?: (params: any) => Promise<any>
    saveVariant?: (params: any) => Promise<any>
    deleteVariant?: (params: any) => Promise<any>
    runTests?: (rowId?: string, variantId?: string) => void
    cancelRunTests?: () => void

    // Utility
    mutate?: () => void
    refetch?: () => void

    // System info
    usingJotaiState: boolean
    featureFlags: ReturnType<typeof getPlaygroundFeatureFlags>

    // Properties needed by PromptMessageConfig (from stateSelector results)
    message?: any
    isChat?: boolean
    isFunction?: boolean
    isJSON?: boolean
    isTool?: boolean
    handleParamUpdate?: (params: any) => void
    baseProperty?: any
    baseImageProperties?: any
    messageRow?: any
    baseContentProperty?: any
    variables?: string[]
    textProperty?: any
}

/**
 * Hook parameters that work with both systems
 */
export interface UnifiedPlaygroundParams {
    variantId?: string
    variantIds?: string[]
    appId?: string
    hookId?: string // Added for compatibility with old usePlayground
    stateSelector?: (state: any) => any
    variantSelector?: (state: any) => any
    // Add other common parameters as needed
}
