/**
 * Feature Flag System Demo
 * Shows how to use the new feature flag system for gradual rollout
 */

import {
    getPlaygroundFeatureFlags,
    updatePlaygroundFeatureFlags,
    applyRolloutConfig,
    enableForPercentage,
    assignToTestGroup,
    logFeatureFlags,
} from "../config/featureFlags"

/**
 * Demo: Basic feature flag usage
 */
export function demoBasicUsage() {
    console.log("=== Basic Feature Flag Usage ===")

    // Get current flags
    const flags = getPlaygroundFeatureFlags()
    console.log("Current flags:", flags)

    // Update specific flags
    updatePlaygroundFeatureFlags({
        useJotaiState: true,
        enableOptimisticUpdates: true,
    })

    console.log("Updated flags:", getPlaygroundFeatureFlags())

    // Log formatted table
    logFeatureFlags()
}

/**
 * Demo: Rollout configurations
 */
export function demoRolloutConfigs() {
    console.log("\n=== Rollout Configuration Demo ===")

    // Conservative rollout
    console.log("Applying CONSERVATIVE config...")
    applyRolloutConfig("CONSERVATIVE")
    logFeatureFlags()

    // Standard rollout
    console.log("Applying STANDARD config...")
    applyRolloutConfig("STANDARD")
    logFeatureFlags()

    // Full rollout
    console.log("Applying FULL config...")
    applyRolloutConfig("FULL")
    logFeatureFlags()
}

/**
 * Demo: Percentage-based rollout
 */
export function demoPercentageRollout() {
    console.log("\n=== Percentage Rollout Demo ===")

    const testUsers = ["user1", "user2", "user3", "user4", "user5"]

    // Enable for 40% of users
    console.log("Enabling Jotai state for 40% of users...")
    testUsers.forEach((userId) => {
        enableForPercentage(userId, 40, "useJotaiState")
        const flags = getPlaygroundFeatureFlags()
        console.log(`${userId}: Jotai enabled = ${flags.useJotaiState}`)
    })
}

/**
 * Demo: A/B testing
 */
export function demoABTesting() {
    console.log("\n=== A/B Testing Demo ===")

    const testGroups = {
        control: {
            useJotaiState: false,
            enableOptimisticUpdates: false,
        },
        experimental: {
            useJotaiState: true,
            enableOptimisticUpdates: true,
        },
        advanced: {
            useJotaiState: true,
            enableOptimisticUpdates: true,
            enableWebSocketUpdates: true,
        },
    }

    const testUsers = ["alice", "bob", "charlie", "diana", "eve", "frank"]

    testUsers.forEach((userId) => {
        const group = assignToTestGroup(userId, testGroups)
        const flags = getPlaygroundFeatureFlags()
        console.log(`${userId} -> ${group}:`, {
            jotai: flags.useJotaiState,
            optimistic: flags.enableOptimisticUpdates,
            websocket: flags.enableWebSocketUpdates,
        })
    })
}

/**
 * Demo: Component usage pattern
 */
export function demoComponentUsage() {
    console.log("\n=== Component Usage Pattern ===")

    // Simulate component using feature flags
    const flags = getPlaygroundFeatureFlags()

    if (flags.useJotaiState) {
        console.log("✅ Using new Jotai-based state management")

        if (flags.enableOptimisticUpdates) {
            console.log("✅ Optimistic updates enabled")
        }

        if (flags.enableWebSocketUpdates) {
            console.log("✅ WebSocket real-time updates enabled")
        }

        if (flags.enableNewVariantCrud) {
            console.log("✅ New variant CRUD operations enabled")
        }
    } else {
        // Using SWR-based state management (demo)
    }
}

/**
 * Demo: Production rollout simulation
 */
export function demoProductionRollout() {
    console.log("\n=== Production Rollout Simulation ===")

    // Week 1: Conservative rollout (internal testing)
    console.log("Week 1: Internal testing with conservative settings")
    applyRolloutConfig("CONSERVATIVE")
    logFeatureFlags()

    // Week 2: 20% rollout with standard features
    console.log("\nWeek 2: 20% user rollout with standard features")
    applyRolloutConfig("STANDARD")
    // In real usage, would enable for 20% of users
    console.log("(Would enable for 20% of users based on user ID hash)")

    // Week 3: 50% rollout
    console.log("\nWeek 3: 50% user rollout")
    console.log("(Would enable for 50% of users)")

    // Week 4: Full rollout
    console.log("\nWeek 4: Full rollout")
    applyRolloutConfig("FULL")
    logFeatureFlags()
}

/**
 * Run all demos
 */
export function runAllDemos() {
    console.log("🚀 Playground Feature Flag System Demo\n")

    demoBasicUsage()
    demoRolloutConfigs()
    demoPercentageRollout()
    demoABTesting()
    demoComponentUsage()
    demoProductionRollout()

    console.log("\n✅ Demo completed! Check the console output above.")
    console.log("💡 Tip: Use these patterns in your components for gradual migration.")
}

// Auto-run demo in development
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    // Uncomment to run demo automatically
    // runAllDemos()
}
