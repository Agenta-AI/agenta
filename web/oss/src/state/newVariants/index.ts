/**
 * New Variants State Management
 *
 * A pure atom-based approach to variant state management with:
 * - Deep link priority loading
 * - Windowing/pagination support
 * - Smart cache redirection
 * - Testable pure atoms
 */

// Core atoms
export * from "./atoms/deepLink"
export * from "./atoms/window"
export * from "./atoms/cache"
export * from "./atoms/strategy"
export * from "./atoms/queries"
export * from "./atoms/derived"
export * from "./atoms/actions"

// Skeleton-enhanced atoms
export * from "./atoms/skeleton-queries"

// API layer
export * from "./api/variants"

// Re-export commonly used types
export type {QueryConfig} from "./atoms/strategy"
export type {WindowConfig, WindowAction} from "./atoms/window"
export type {DeepLinkContext} from "./atoms/deepLink"
export type {VariantQueryOptions, VariantQueryResponse} from "./api/variants"
