/**
 * New Project State Management - Main Export
 *
 * This module provides comprehensive project state management following the established
 * patterns from newApps, newVariants, newEnvironments, newOrg, newProfile, and newWorkspace. It includes:
 *
 * - Core project fetching and selection logic
 * - Project search and filtering capabilities
 * - Project statistics and analytics
 * - Skeleton loading states
 * - Mutation atoms for project operations
 * - Performance monitoring and analytics
 */

// Export all atoms
export * from "./atoms"

// Re-export commonly used utilities for convenience
export {isSkeletonProject, filterSkeletonProjects} from "./atoms/skeleton"
