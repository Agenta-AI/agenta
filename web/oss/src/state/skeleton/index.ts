/**
 * Skeleton Data System - Main Export
 *
 * A comprehensive system for providing skeleton data during loading states
 * to improve perceived performance and enable incremental UI updates
 *
 * @example Basic Usage
 * ```typescript
 * import { atomWithSkeletonQuery, createSkeletonApps } from '@/state/skeleton'
 *
 * const mySkeletonAtom = atomWithSkeletonQuery(
 *   queryOptions,
 *   createSkeletonApps,
 *   { count: 5, realisticValues: true }
 * )
 * ```
 *
 * @example Component Usage
 * ```tsx
 * const MyComponent = () => {
 *   const tableState = useAtomValue(appTableSkeletonSelectorAtom)
 *
 *   return (
 *     <Table
 *       dataSource={tableState.data}
 *       loading={tableState.loading && !tableState.isSkeleton}
 *     />
 *   )
 * }
 * ```
 */

// Core types
export type {
    SkeletonMetadata,
    SkeletonData,
    SkeletonConfig,
    SkeletonGenerator,
    IncrementalUpdateConfig,
    LoadingState,
} from "./types"

// Skeleton data generators
export {
    createSkeletonMetadata,
    wrapWithSkeletonMeta,
    createSkeletonApps,
    createSkeletonTableData,
    createSkeletonSelectorOptions,
    createSkeletonAppStats,
    isSkeletonData,
    extractData,
    hasSkeletonItems,
} from "./generators"

// Enhanced loadable atoms
export {
    atomWithSkeletonQuery,
    skeletonLoadableAtom,
    incrementalLoadingAtom,
    skeletonLoadingStateAtom,
} from "./loadable"

// NewApps integration
export {
    appsSkeletonQueryAtom,
    appsSkeletonAtom,
    appTableSkeletonDataAtom,
    appSelectorSkeletonOptionsAtom,
    currentAppSkeletonAtom,
    appsSkeletonLoadingAtom,
    appsSkeletonErrorAtom,
    appsSkeletonCountAtom,
    appStatsSkeletonAtom,
    hasSkeletonDataAtom,
    appsLoadingProgressAtom,
} from "../newApps/atoms/skeleton-queries"

// Enhanced selectors
export {
    appTableSkeletonSelectorAtom,
    appSelectorSkeletonStateAtom,
    appManagementSkeletonActionsAtom,
    appStatsSkeletonSelectorAtom,
    currentAppSkeletonContextAtom,
    progressiveLoadingAtom,
    smartRefreshAtom,
} from "../newApps/selectors/skeleton-apps"

// React components and examples
export {
    SkeletonAppTable,
    SkeletonAppSelector,
    SkeletonAppStats,
    ProgressiveLoadingDashboard,
    SkeletonAppManagementPage,
    skeletonStyles,
} from "./examples"

/**
 * Migration Guide from Regular Atoms to Skeleton Atoms
 *
 * 1. Replace regular query atoms:
 *    - `appsAtom` → `appsSkeletonAtom`
 *    - `appTableDataAtom` → `appTableSkeletonDataAtom`
 *    - `appSelectorOptionsAtom` → `appSelectorSkeletonOptionsAtom`
 *
 * 2. Update selectors:
 *    - `appTableSelectorAtom` → `appTableSkeletonSelectorAtom`
 *    - `appSelectorStateAtom` → `appSelectorSkeletonStateAtom`
 *
 * 3. Update components to handle skeleton data:
 *    - Check `isSkeleton` property in state
 *    - Render skeleton UI for items with `_skeleton.isLoading`
 *    - Use progressive loading indicators
 *
 * 4. Benefits:
 *    - Immediate UI rendering with realistic placeholder data
 *    - Better perceived performance
 *    - Incremental loading with partial data updates
 *    - Graceful error handling with skeleton fallbacks
 */

/**
 * Performance Considerations
 *
 * - Skeleton data is generated once and cached
 * - Uses eagerAtom for immediate evaluation
 * - Minimal re-renders with deep equality checks
 * - Progressive enhancement reduces blocking operations
 * - Memory efficient with selective skeleton generation
 */

/**
 * Best Practices
 *
 * 1. Use realistic skeleton data that matches your UI structure
 * 2. Implement progressive loading for complex nested data
 * 3. Provide visual feedback for loading progress
 * 4. Handle skeleton states in your components gracefully
 * 5. Use incremental loading for better perceived performance
 * 6. Test skeleton states in your component tests
 */
