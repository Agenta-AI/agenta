/**
 * New Apps State Management - Main Export
 *
 * Centralized exports for the new optimized apps state management system.
 * This follows the same pattern as newVariants for consistency.
 */

// API functions
export * from "./api/apps"

// Query atoms
export * from "./atoms/queries"

// Mutation atoms
export * from "./atoms/mutations"

// High-level selectors
export * from "./selectors/apps"

// Type re-exports for convenience
export type {ListAppsItem} from "@/oss/lib/Types"
