/**
 * New Workspace State Management - Main Export
 *
 * This module provides comprehensive workspace state management following the established
 * patterns from newApps, newVariants, newEnvironments, newOrg, and newProfile. It includes:
 *
 * - Core workspace fetching and member management
 * - Member search and filtering capabilities
 * - Role-based access control and permissions
 * - Skeleton loading states
 * - Mutation atoms for workspace operations
 * - Performance monitoring and analytics
 */

// Export all atoms
export * from "./atoms"

// Re-export commonly used utilities for convenience
export {
    isSkeletonWorkspace,
    isSkeletonMember,
    filterSkeletonMembers,
    filterSkeletonWorkspace,
} from "./atoms/skeleton"
