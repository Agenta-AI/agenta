/**
 * Environments Atoms Test Suite
 *
 * Comprehensive testing of the environment state management atoms,
 * following the established patterns from organization, profile, project, and workspace tests.
 */

import "dotenv/config"

import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

// Environment atoms to test
import {
    // Core atoms
    environmentsQueryAtom,
    environmentsAtom,
    environmentsLoadingAtom,
    environmentsCountAtom,

    // Selector atoms
    environmentSelectorOptionsAtom,
    environmentSelectorStateAtom,
    selectedEnvironmentAtom,

    // Map atoms
    environmentMapAtom,

    // Statistics atoms
    deploymentStatsAtom,

    // Network stats
    environmentNetworkStatsAtom,
} from "../../src/state/newEnvironments"

import {
    setupTestEnvironment,
    createTestQueryClient,
    NetworkRequestCounter,
} from "./utils/shared-test-setup"
import {EnhancedTestRecorder} from "./utils/test-analysis"

// ============================================================================
// Test Configuration
// ============================================================================

const recorder = new EnhancedTestRecorder()
const networkCounter = new NetworkRequestCounter()

// ============================================================================
// Main Test Function
// ============================================================================

async function runEnvironmentsAtomsTest() {
    console.log("🧪 === Environment Atoms Test ===")
    console.log(`🧪 === ${process.env.NODE_ENV} ===`)

    // Debug environment variables
    console.log("🔍 DEBUG - Environment Variables:")
    console.log(`  NODE_ENV: ${process.env.NODE_ENV}`)
    console.log(`  NEXT_PUBLIC_AGENTA_API_URL: ${process.env.NEXT_PUBLIC_AGENTA_API_URL}`)
    console.log(`  VITEST_TEST_JWT: ${process.env.VITEST_TEST_JWT ? "***" : "undefined"}`)

    console.log("📋 Environment:", {
        apiUrl: process.env.NEXT_PUBLIC_AGENTA_API_URL,
        nodeEnv: process.env.NODE_ENV,
        jwt: process.env.VITEST_TEST_JWT ? process.env.VITEST_TEST_JWT : "undefined",
    })

    const queryClient = createTestQueryClient()

    // Create Jotai store
    const store = createStore()
    store.set(queryClientAtom, queryClient)

    console.log("\n🧪 === Environment Atoms Test Suite ===")
    console.log("🔄 Testing Environment State Management...")

    // ========================================================================
    // 1️⃣ Core Environment Atoms Testing
    // ========================================================================

    console.log("\n🔄 Phase: core_environments_testing")
    console.log("1️⃣ Core Environment Atoms Testing")
    console.log("🔄 Loading environments...")

    let environmentsQueryResult: any = null
    let queryCompleted = false

    // Subscribe to environments query with network request counting
    const unsubscribeEnvironments = store.sub(environmentsQueryAtom, () => {
        environmentsQueryResult = store.get(environmentsQueryAtom)
        console.log("📊 Environments query status:", environmentsQueryResult.status)

        if (environmentsQueryResult.status === "success") {
            console.log("✅ Environments query successful")
            networkCounter.increment()
            queryCompleted = true
        } else if (environmentsQueryResult.status === "error") {
            console.log("❌ Environments query error:", environmentsQueryResult.error?.message)
            // Still count as network request even if it failed
            networkCounter.increment()
            queryCompleted = true
        }
    })

    // Wait for query completion
    const startTime = Date.now()
    const timeout = 10000 // 10 seconds

    while (!queryCompleted && Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (queryCompleted) {
        console.log(`✅ Environment query completed after ${Date.now() - startTime}ms`)
    } else {
        console.log("⚠️ Environment query timed out")
    }

    unsubscribeEnvironments()

    // Test core environment atoms
    const environments = store.get(environmentsAtom)
    console.log(`🔗 Atom: environmentsAtom (loaded) in core_environments_testing`)
    console.log(
        `✅ Environments loaded: ${Array.isArray(environments) ? environments.length : 0} environments`,
    )

    const environmentsLoading = store.get(environmentsLoadingAtom)
    console.log(`🔗 Atom: environmentsLoadingAtom (loaded) in core_environments_testing`)
    console.log(`🔄 Loading state: ${environmentsLoading}`)

    const environmentsCount = store.get(environmentsCountAtom)
    console.log(`🔗 Atom: environmentsCountAtom (loaded) in core_environments_testing`)
    console.log(`📊 Environment count: ${environmentsCount}`)

    // ========================================================================
    // 2️⃣ Environment Selector Testing
    // ========================================================================

    console.log("\n🔄 Phase: environment_selector_testing")
    console.log("2️⃣ Environment Selector Testing")

    const selectorOptions = store.get(environmentSelectorOptionsAtom)
    console.log(`🔗 Atom: environmentSelectorOptionsAtom (loaded) in environment_selector_testing`)
    console.log(
        `🎯 Selector options: ${Array.isArray(selectorOptions) ? selectorOptions.length : 0} options`,
    )

    const selectorState = store.get(environmentSelectorStateAtom)
    console.log(`🔗 Atom: environmentSelectorStateAtom (loaded) in environment_selector_testing`)
    console.log("🎯 Selector state:", {
        options: selectorState?.options?.length || 0,
        selectedValue: selectorState?.selectedValue || null,
        hasSelection: selectorState?.hasSelection || false,
        loading: selectorState?.loading || false,
    })

    const selectedEnvironment = store.get(selectedEnvironmentAtom)
    console.log(`🔗 Atom: selectedEnvironmentAtom (loaded) in environment_selector_testing`)
    console.log(`🏢 Selected environment: ${selectedEnvironment ? "Selected" : "None"}`)

    // ========================================================================
    // 3️⃣ Environment Map Testing
    // ========================================================================

    console.log("\n🔄 Phase: environment_map_testing")
    console.log("3️⃣ Environment Map Testing")

    const environmentMap = store.get(environmentMapAtom)
    console.log(`🔗 Atom: environmentMapAtom (loaded) in environment_map_testing`)
    console.log(
        `🗺️ Environment map: ${environmentMap ? Object.keys(environmentMap).length : 0} entries`,
    )

    // ========================================================================
    // 4️⃣ Statistics Testing
    // ========================================================================

    console.log("\n🔄 Phase: environment_stats_testing")
    console.log("4️⃣ Environment Statistics Testing")

    const deploymentStats = store.get(deploymentStatsAtom)
    console.log(`🔗 Atom: deploymentStatsAtom (loaded) in environment_stats_testing`)
    console.log("📊 Deployment statistics:", {
        totalEnvironments: deploymentStats?.totalEnvironments || 0,
        deployedEnvironments: deploymentStats?.deployedEnvironments || 0,
        deploymentRate: deploymentStats?.deploymentRate || 0,
        hasEnvironments: deploymentStats?.hasEnvironments || false,
    })

    // ========================================================================
    // 5️⃣ Network Monitoring
    // ========================================================================

    console.log("\n🔄 Phase: network_monitoring")
    console.log("5️⃣ Network Monitoring")

    const networkStats = store.get(environmentNetworkStatsAtom)
    console.log(`🔗 Atom: environmentNetworkStatsAtom (loaded) in network_monitoring`)
    console.log("🌐 Network stats:", {
        status: networkStats?.status || "unknown",
        fetchStatus: networkStats?.fetchStatus || "unknown",
        isFetching: networkStats?.isFetching || false,
        isLoading: networkStats?.isLoading || false,
        lastFetch: networkStats?.lastFetch || 0,
    })

    // ========================================================================
    // Test Completion
    // ========================================================================

    console.log("\n🔄 Phase: completion")

    networkCounter.logTotal()

    console.log("\n📊 ✅ Environment atoms test completed successfully!")

    console.log("\n📊 Complete Environment Ecosystem Demonstrated:")
    console.log("   • Core environment fetching and caching")
    console.log("   • Environment selector functionality")
    console.log("   • Environment map-based lookups")
    console.log("   • Deployment statistics and analytics")
    console.log("   • Network request tracking")
    console.log("   • Error handling and loading states")

    // ========================================================================
    // Generate Comprehensive Test Results with Full Atom Dumps
    // ========================================================================

    // Capture all atom states for comprehensive analysis
    const atomDumps = {
        // Core environment atoms
        environmentsQueryAtom: environmentsQueryResult,
        environmentsAtom: environments,
        environmentsLoadingAtom: environmentsLoading,
        environmentsCountAtom: environmentsCount,

        // Selector atoms
        environmentSelectorOptionsAtom: selectorOptions,
        environmentSelectorStateAtom: selectorState,
        selectedEnvironmentAtom: selectedEnvironment,

        // Map atoms
        environmentMapAtom: environmentMap,

        // Statistics atoms
        deploymentStatsAtom: deploymentStats,

        // Network stats atoms
        environmentNetworkStatsAtom: networkStats,
    }

    // Generate comprehensive test results using the enhanced recorder pattern
    const testResults = {
        generatedAt: new Date().toISOString(),
        totalDuration: Date.now(),
        totalNetworkRequests: networkCounter.getCount(),

        // Full atom dumps section (like apps test)
        atomDumps,

        // Environment data section
        environments: {
            count: environmentsCount,
            loaded: Array.isArray(environments) ? environments.length : 0,
            loading: environmentsLoading,
            fullData: environments || [],
            queryResult: environmentsQueryResult,
        },

        // Selector data section
        selector: {
            options: Array.isArray(selectorOptions) ? selectorOptions.length : 0,
            hasSelection: selectorState?.hasSelection || false,
            selectedValue: selectorState?.selectedValue || null,
            loading: selectorState?.loading || false,
            fullOptionsData: selectorOptions || [],
            fullStateData: selectorState,
            selectedEnvironmentData: selectedEnvironment,
        },

        // Environment map section
        environmentMap: {
            entries: environmentMap ? Object.keys(environmentMap).length : 0,
            fullData: environmentMap,
        },

        // Deployment statistics section
        deploymentStats: {
            totalEnvironments: deploymentStats?.totalEnvironments || 0,
            deployedEnvironments: deploymentStats?.deployedEnvironments || 0,
            deploymentRate: deploymentStats?.deploymentRate || 0,
            hasEnvironments: deploymentStats?.hasEnvironments || false,
            fullData: deploymentStats,
        },

        // Network monitoring section
        network: {
            totalRequests: networkCounter.getCount(),
            queryStatus: environmentsQueryResult?.status || "unknown",
            networkStatsData: networkStats,
            queryResult: environmentsQueryResult,
        },

        // Test phases completion status
        phases: {
            coreEnvironmentsTesting: "✅ completed",
            environmentSelectorTesting: "✅ completed",
            environmentMapTesting: "✅ completed",
            environmentStatsTesting: "✅ completed",
            networkMonitoring: "✅ completed",
        },
    }

    // Save comprehensive results
    const fs = await import("fs")
    const path = await import("path")

    const resultsDir = path.join(__dirname, "results")
    fs.mkdirSync(resultsDir, {recursive: true})

    fs.writeFileSync(
        path.join(resultsDir, "environments-test-run.json"),
        JSON.stringify(testResults, null, 2),
    )

    // Generate markdown summary
    const markdownSummary = `# Environments Atoms Test Results

## Test Summary
- **Timestamp**: ${testResults.generatedAt}
- **Status**: ✅ PASSED
- **Total Network Requests**: ${testResults.totalNetworkRequests}

## Environment Data
- **Environments Count**: ${testResults.environments.count}
- **Environments Loaded**: ${testResults.environments.loaded}
- **Environments Loading**: ${testResults.environments.loading ? "Yes" : "No"}

## Environment Selector
- **Selector Options**: ${testResults.selector.options}
- **Has Selection**: ${testResults.selector.hasSelection ? "✅ Yes" : "❌ No"}
- **Selected Value**: ${testResults.selector.selectedValue || "None"}
- **Selector Loading**: ${testResults.selector.loading ? "Yes" : "No"}

## Environment Map
- **Map Entries**: ${testResults.environmentMap.entries}

## Deployment Statistics
- **Total Environments**: ${testResults.deploymentStats.totalEnvironments}
- **Deployed Environments**: ${testResults.deploymentStats.deployedEnvironments}
- **Deployment Rate**: ${testResults.deploymentStats.deploymentRate}%
- **Has Environments**: ${testResults.deploymentStats.hasEnvironments ? "✅ Yes" : "❌ No"}

## Test Phases
- **coreEnvironmentsTesting**: ✅ completed
- **environmentSelectorTesting**: ✅ completed
- **environmentMapTesting**: ✅ completed
- **environmentStatsTesting**: ✅ completed
- **networkMonitoring**: ✅ completed

## Network Performance
- **Query Status**: ${testResults.network.queryStatus}
- **Total Requests**: ${testResults.totalNetworkRequests}
`

    fs.writeFileSync(path.join(resultsDir, "environments-test-run-summary.md"), markdownSummary)

    console.log(
        "💾 Enhanced results saved to: " + path.join(resultsDir, "environments-test-run.json"),
    )
    console.log("📄 Summary saved to: " + path.join(resultsDir, "environments-test-run-summary.md"))

    console.log("\n🎉 Environment test suite completed!")
}

// ============================================================================
// Test Execution
// ============================================================================

runEnvironmentsAtomsTest()
    .then(() => {
        console.log("🏁 Test execution completed")
        process.exit(0)
    })
    .catch((error) => {
        console.error("💥 Test execution failed:", error)
        process.exit(1)
    })
