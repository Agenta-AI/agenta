/**
 * Project Utility Functions
 *
 * Shared utilities for project-related operations across the state management system
 */

/**
 * Get the current project ID from environment or context
 * Used by API functions that need project scoping
 */
export const getProjectId = (): string | null => {
    // In test environment, use test project ID
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
        return process.env.VITEST_TEST_PROJECT_ID || null
    }

    // In browser environment, this would typically come from router or context
    // For now, return null and let the calling code handle it
    return null
}
