/**
 * Skeleton Data System Types
 *
 * Provides type-safe skeleton data generation and management
 * for better loading states and incremental updates
 */

export interface SkeletonMetadata {
    isSkeleton: boolean
    loadingStage: "initial" | "partial" | "complete"
    priority: "high" | "medium" | "low"
    timestamp: number
}

export interface SkeletonData<T> {
    data: T
    meta: SkeletonMetadata
}

export interface SkeletonConfig {
    count?: number
    priority?: SkeletonMetadata["priority"]
    includeNested?: boolean
    realisticValues?: boolean
}

export type SkeletonGenerator<T> = (config?: SkeletonConfig) => T[]

export interface IncrementalUpdateConfig {
    preserveSkeletonStructure?: boolean
    mergeStrategy?: "replace" | "merge" | "append"
    priorityOrder?: string[]
}

export interface LoadingState {
    isLoading: boolean
    isSkeleton: boolean
    loadingStage: SkeletonMetadata["loadingStage"]
    progress?: number
}
