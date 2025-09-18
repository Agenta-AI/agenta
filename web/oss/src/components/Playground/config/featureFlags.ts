/**
 * Feature flags for Playground state management refactor
 * Enables gradual rollout and A/B testing of new Jotai-based system
 */

export interface PlaygroundFeatureFlags {
    /** Enable Jotai-based state management instead of SWR middleware */
    useJotaiState: boolean
    /** Enable optimistic updates in mutations */
    enableOptimisticUpdates: boolean
    /** Enable WebSocket real-time updates */
    enableWebSocketUpdates: boolean
    /** Enable new variant CRUD operations */
    enableNewVariantCrud: boolean
    /** Enable new test execution system */
    enableNewTestExecution: boolean
    /** Debug mode for development */
    debugMode: boolean
}

/**
 * Default feature flag configuration
 * Can be overridden by environment variables or user settings
 */
const DEFAULT_FLAGS: PlaygroundFeatureFlags = {
    useJotaiState: process.env.NEXT_PUBLIC_USE_JOTAI_PLAYGROUND === "true",
    enableOptimisticUpdates: process.env.NEXT_PUBLIC_ENABLE_OPTIMISTIC_UPDATES === "true",
    enableWebSocketUpdates: process.env.NEXT_PUBLIC_ENABLE_WEBSOCKET_UPDATES === "true",
    enableNewVariantCrud: process.env.NEXT_PUBLIC_ENABLE_NEW_VARIANT_CRUD === "true",
    enableNewTestExecution: process.env.NEXT_PUBLIC_ENABLE_NEW_TEST_EXECUTION === "true",
    debugMode: process.env.NODE_ENV === "development",
}

/**
 * Runtime feature flag overrides
 * Can be modified for A/B testing or gradual rollout
 */
let runtimeFlags: Partial<PlaygroundFeatureFlags> = {}

/**
 * Get current feature flag configuration
 */
export function getPlaygroundFeatureFlags(): PlaygroundFeatureFlags {
    return {
        ...DEFAULT_FLAGS,
        ...runtimeFlags,
    }
}

/**
 * Update runtime feature flags
 * Useful for A/B testing and gradual rollout
 */
export function updatePlaygroundFeatureFlags(flags: Partial<PlaygroundFeatureFlags>): void {
    runtimeFlags = {...runtimeFlags, ...flags}

    if (DEFAULT_FLAGS.debugMode) {
        console.log("Playground feature flags updated:", getPlaygroundFeatureFlags())
    }
}

/**
 * Reset feature flags to defaults
 */
export function resetPlaygroundFeatureFlags(): void {
    runtimeFlags = {}
}

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: keyof PlaygroundFeatureFlags): boolean {
    return getPlaygroundFeatureFlags()[feature]
}

/**
 * Gradual rollout helper
 * Enables features for a percentage of users based on user ID hash
 */
export function enableForPercentage(
    userId: string,
    percentage: number,
    feature: keyof PlaygroundFeatureFlags,
): void {
    if (percentage <= 0) return
    if (percentage >= 100) {
        updatePlaygroundFeatureFlags({[feature]: true})
        return
    }

    // Simple hash function for consistent user assignment
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
        const char = userId.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash // Convert to 32-bit integer
    }

    const userPercentile = Math.abs(hash) % 100
    const shouldEnable = userPercentile < percentage

    updatePlaygroundFeatureFlags({[feature]: shouldEnable})
}

/**
 * A/B test helper
 * Assigns users to test groups based on user ID
 */
export function assignToTestGroup(
    userId: string,
    testGroups: Record<string, Partial<PlaygroundFeatureFlags>>,
): string {
    const groupNames = Object.keys(testGroups)
    if (groupNames.length === 0) return "control"

    // Hash user ID to consistently assign to same group
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
        const char = userId.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash
    }

    const groupIndex = Math.abs(hash) % groupNames.length
    const assignedGroup = groupNames[groupIndex]

    // Apply the group's feature flags
    updatePlaygroundFeatureFlags(testGroups[assignedGroup])

    if (DEFAULT_FLAGS.debugMode) {
        console.log(`User ${userId} assigned to test group: ${assignedGroup}`)
    }

    return assignedGroup
}

/**
 * Predefined rollout configurations
 */
export const ROLLOUT_CONFIGS = {
    /** Conservative rollout - core features only */
    CONSERVATIVE: {
        useJotaiState: true,
        enableOptimisticUpdates: false,
        enableWebSocketUpdates: false,
        enableNewVariantCrud: false,
        enableNewTestExecution: false,
        debugMode: DEFAULT_FLAGS.debugMode,
    },

    /** Standard rollout - most features enabled */
    STANDARD: {
        useJotaiState: true,
        enableOptimisticUpdates: true,
        enableWebSocketUpdates: false,
        enableNewVariantCrud: true,
        enableNewTestExecution: false,
        debugMode: DEFAULT_FLAGS.debugMode,
    },

    /** Full rollout - all features enabled */
    FULL: {
        useJotaiState: true,
        enableOptimisticUpdates: true,
        enableWebSocketUpdates: true,
        enableNewVariantCrud: true,
        enableNewTestExecution: true,
        debugMode: DEFAULT_FLAGS.debugMode,
    },

    /** Development mode - all features with debug */
    DEVELOPMENT: {
        useJotaiState: true,
        enableOptimisticUpdates: true,
        enableWebSocketUpdates: true,
        enableNewVariantCrud: true,
        enableNewTestExecution: true,
        debugMode: true,
    },
} as const

/**
 * Apply a predefined rollout configuration
 */
export function applyRolloutConfig(config: keyof typeof ROLLOUT_CONFIGS): void {
    updatePlaygroundFeatureFlags(ROLLOUT_CONFIGS[config])
}

/**
 * Development helper to log current feature flag state
 */
export function logFeatureFlags(): void {
    if (DEFAULT_FLAGS.debugMode) {
        console.table(getPlaygroundFeatureFlags())
    }
}
