/**
 * New Profile State Management - Main Export
 *
 * This module provides comprehensive profile state management following the established
 * patterns from newApps, newVariants, newEnvironments, and newOrg. It includes:
 *
 * - Core profile fetching and caching
 * - User authentication state management
 * - Profile update operations
 * - Skeleton loading states
 * - Mutation atoms for profile operations
 * - Performance monitoring and analytics
 */

// Export all atoms
export * from "./atoms"

// Re-export commonly used utilities for convenience
export {isSkeletonUser, filterSkeletonUser} from "./atoms/skeleton"
