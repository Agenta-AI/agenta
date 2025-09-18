/**
 * New Organization State Management - Main Export
 *
 * This module provides comprehensive organization state management following the established
 * patterns from newApps, newVariants, and newEnvironments. It includes:
 *
 * - Core organization fetching and caching
 * - Selected organization state with persistence
 * - Organization selector atoms for UI components
 * - Skeleton loading states
 * - Mutation atoms for organization operations
 * - Performance monitoring and analytics
 */

// Export all atoms
export * from "./atoms"

// Re-export commonly used utilities for convenience
export {isSkeletonOrg, isSkeletonOrgDetails, filterSkeletonOrgs} from "./atoms/skeleton"
