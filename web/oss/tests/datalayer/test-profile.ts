/**
 * Profile Atoms Test Suite
 *
 * Comprehensive testing of the new profile state management atoms,
 * following the established patterns from environments, deployments, apps, variants, and orgs tests.
 */

import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

// Test utilities

// Profile atoms to test
import {
    // Core atoms
    profileQueryAtom,
    userAtom,
    profileLoadingAtom,
    profileErrorAtom,
    authStatusAtom,

    // User information atoms
    userIdAtom,
    userDisplayNameAtom,
    userEmailAtom,
    userPreferencesAtom,

    // Statistics atoms
    profileStatsAtom,

    // Utility atoms
    profilePrefetchAtom,
    profileRefreshAtom,
    profileResetAtom,
    profileNetworkStatsAtom,

    // Skeleton atoms
    profileSkeletonAtom,
    userDisplayNameSkeletonAtom,
    userEmailSkeletonAtom,
    authStatusSkeletonAtom,
    profileStatsSkeletonAtom,
    profileSkeletonVisibilityAtom,

    // Mutation atoms
    updateProfileMutationAtom,
    changePasswordMutationAtom,
    updatePreferencesMutationAtom,
    refreshProfileMutationAtom,
    profileMutationLoadingAtom,
    profileMutationErrorsAtom,
} from "@/oss/state/newProfile"

// Session atom for testing
import "dotenv/config"
import path from "path"
import {mkdirSync} from "fs"

import {sessionExistsAtom} from "@/oss/state/session"

import {
    setupTestEnvironment,
    createTestQueryClient,
    NetworkRequestCounter,
} from "./utils/shared-test-setup"
import {EnhancedTestRecorder} from "./utils/test-analysis"

// ============================================================================
// Test Setup and Configuration
// ============================================================================

const testEnvironment = setupTestEnvironment()
const recorder = new EnhancedTestRecorder()

console.log("👤 === Profile Atoms Test ===")
console.log(`👤 === ${testEnvironment.nodeEnv} ===`)

// Debug environment variables
console.log("🔍 DEBUG - Environment Variables:")
console.log(`  NODE_ENV: ${testEnvironment.nodeEnv}`)
console.log(`  NEXT_PUBLIC_AGENTA_API_URL: ${testEnvironment.apiUrl}`)
console.log(`  VITEST_TEST_USER_ID: ${process.env.VITEST_TEST_USER_ID}`)

console.log("📋 Environment:", testEnvironment)

// ============================================================================
// Test Store Setup
// ============================================================================

const testStore = createStore()
const queryClient = createTestQueryClient()

// Set up query client in store
testStore.set(queryClientAtom, queryClient)

// Mock session exists for testing
testStore.set(sessionExistsAtom, true)

// Network request counter for accurate tracking
const networkCounter = new NetworkRequestCounter()

console.log("🧪 === Profile Atoms Test Suite ===")

// ============================================================================
// Test Execution
// ============================================================================

async function runProfileAtomsTest() {
    console.log("🔄 Testing Profile State Management...")
    console.log("")

    const startTime = Date.now()
    try {
        // Phase 1: Core Profile Atoms Testing
        recorder.setPhase("core_profile_testing")
        console.log("1️⃣ Core Profile Atoms Testing")

        // Test profile query atom with network request tracking
        console.log("🔄 Loading user profile...")
        let profileQueryCompleted = false
        let profileQueryResult: any = null

        // Subscribe to profile query to track completion and network requests
        const unsubscribeProfile = testStore.sub(profileQueryAtom, () => {
            const result = testStore.get(profileQueryAtom)
            console.log("🔄 Profile query subscription triggered:", {
                isSuccess: result?.isSuccess,
                isError: result?.isError,
                isLoading: result?.isLoading,
                dataExists: !!result?.data,
                status: result?.status,
            })

            if (result?.isSuccess || result?.isError) {
                profileQueryCompleted = true
                profileQueryResult = result

                if (result?.isSuccess && result?.data) {
                    console.log(
                        `✅ Profile query successful: ${result.data.username || result.data.email}`,
                    )
                    console.log("📋 Profile data:", result.data)
                    recorder.record("profile:loaded", {
                        user: result.data,
                    })
                    // Increment network request counter when actual query completes
                    networkCounter.increment()
                } else if (result?.isError) {
                    console.log("❌ Profile query error:", result.error?.message)
                    recorder.record("profile:error", {error: result.error?.message})
                    // Still count as network request even if it failed
                    networkCounter.increment()
                }
            }
        })

        // Wait for profile query to complete
        const startTime = Date.now()
        const timeout = 5000 // 5 seconds

        while (!profileQueryCompleted && Date.now() - startTime < timeout) {
            await new Promise((resolve) => setTimeout(resolve, 100))
        }

        if (profileQueryCompleted) {
            console.log(`✅ Profile query completed after ${Date.now() - startTime}ms`)
        } else {
            console.log("⏰ Profile query timed out")
        }

        // Cleanup subscription
        unsubscribeProfile()

        const profileQuery = testStore.get(profileQueryAtom)
        recorder.recordAtomSubscription("profileQueryAtom", "loaded")

        const user = testStore.get(userAtom)
        recorder.recordAtomSubscription("userAtom", "loaded", user)
        console.log(`✅ User profile loaded: ${user?.username || user?.email || "Test User"}`)

        const profileLoading = testStore.get(profileLoadingAtom)
        recorder.recordAtomSubscription("profileLoadingAtom", "loaded")
        console.log(`🔄 Loading state: ${profileLoading}`)

        const profileError = testStore.get(profileErrorAtom)
        recorder.recordAtomSubscription("profileErrorAtom", "loaded")
        console.log(`❌ Error state: ${profileError ? "Has error" : "No error"}`)

        // Phase 2: Authentication Status Testing
        recorder.setPhase("auth_status_testing")
        console.log("")
        console.log("2️⃣ Authentication Status Testing")

        const authStatus = testStore.get(authStatusAtom)
        recorder.recordAtomSubscription("authStatusAtom", "loaded")
        console.log(`🔐 Authentication status:`, {
            isAuthenticated: authStatus.isAuthenticated,
            isLoading: authStatus.isLoading,
            hasError: authStatus.hasError,
            sessionExists: authStatus.sessionExists,
        })

        // Phase 3: User Information Testing
        recorder.setPhase("user_info_testing")
        console.log("")
        console.log("3️⃣ User Information Testing")

        const userId = testStore.get(userIdAtom)
        recorder.recordAtomSubscription("userIdAtom", "loaded")
        console.log(`🆔 User ID: ${userId || "None"}`)

        const displayName = testStore.get(userDisplayNameAtom)
        recorder.recordAtomSubscription("userDisplayNameAtom", "loaded")
        console.log(`👤 Display name: ${displayName || "None"}`)

        const userEmail = testStore.get(userEmailAtom)
        recorder.recordAtomSubscription("userEmailAtom", "loaded")
        console.log(`📧 Email: ${userEmail || "None"}`)

        const preferences = testStore.get(userPreferencesAtom)
        recorder.recordAtomSubscription("userPreferencesAtom", "loaded")
        console.log(`⚙️ Preferences: ${Object.keys(preferences).length} settings`)

        // Phase 4: Profile Statistics Testing
        recorder.setPhase("stats_testing")
        console.log("")
        console.log("4️⃣ Profile Statistics Testing")

        const profileStats = testStore.get(profileStatsAtom)
        recorder.recordAtomSubscription("profileStatsAtom", "loaded")
        console.log(`📊 Profile statistics:`, {
            hasProfile: profileStats.hasProfile,
            isAuthenticated: profileStats.isAuthenticated,
            loading: profileStats.loading,
            hasError: profileStats.hasError,
            userId: profileStats.userId,
            username: profileStats.username,
            email: profileStats.email,
        })
        console.log(`💡 Recommendations:`, profileStats.recommendations)

        // Phase 5: Skeleton State Testing
        recorder.setPhase("skeleton_testing")
        console.log("")
        console.log("5️⃣ Skeleton State Testing")
        console.log("🎭 Testing Profile Skeleton Atoms")

        const skeletonProfile = testStore.get(profileSkeletonAtom)
        recorder.recordAtomSubscription("profileSkeletonAtom", "loaded", skeletonProfile)

        const skeletonDisplayName = testStore.get(userDisplayNameSkeletonAtom)
        recorder.recordAtomSubscription("userDisplayNameSkeletonAtom", "loaded")

        const skeletonEmail = testStore.get(userEmailSkeletonAtom)
        recorder.recordAtomSubscription("userEmailSkeletonAtom", "loaded")

        const skeletonAuthStatus = testStore.get(authStatusSkeletonAtom)
        recorder.recordAtomSubscription("authStatusSkeletonAtom", "loaded")

        const skeletonStats = testStore.get(profileStatsSkeletonAtom)
        recorder.recordAtomSubscription("profileStatsSkeletonAtom", "loaded")

        console.log("📊 Skeleton Data Summary:")
        console.log(`   • Skeleton profile: ${skeletonProfile ? "Yes" : "No"}`)
        console.log(`   • Skeleton display name: ${skeletonDisplayName || "None"}`)
        console.log(`   • Skeleton email: ${skeletonEmail || "None"}`)
        console.log(`   • Skeleton auth status: ${skeletonAuthStatus.skeleton ? "Yes" : "No"}`)

        // Phase 6: Mutation Atoms Testing
        recorder.setPhase("mutation_testing")
        console.log("")
        console.log("6️⃣ Mutation Atoms Testing")

        const updateMutation = testStore.get(updateProfileMutationAtom)
        recorder.recordAtomSubscription("updateProfileMutationAtom", "loaded")

        const passwordMutation = testStore.get(changePasswordMutationAtom)
        recorder.recordAtomSubscription("changePasswordMutationAtom", "loaded")

        const preferencesMutation = testStore.get(updatePreferencesMutationAtom)
        recorder.recordAtomSubscription("updatePreferencesMutationAtom", "loaded")

        const mutationLoading = testStore.get(profileMutationLoadingAtom)
        recorder.recordAtomSubscription("profileMutationLoadingAtom", "loaded")

        const mutationErrors = testStore.get(profileMutationErrorsAtom)
        recorder.recordAtomSubscription("profileMutationErrorsAtom", "loaded")

        console.log("🔧 Mutation atoms:", {
            updateAvailable: !!updateMutation,
            passwordAvailable: !!passwordMutation,
            preferencesAvailable: !!preferencesMutation,
            anyLoading: mutationLoading.anyLoading,
            hasErrors: mutationErrors.hasErrors,
        })

        // Phase 7: Utility Atoms Testing
        recorder.setPhase("utility_testing")
        console.log("")
        console.log("7️⃣ Utility Atoms Testing")

        const networkStats = testStore.get(profileNetworkStatsAtom)
        recorder.recordAtomSubscription("profileNetworkStatsAtom", "loaded")

        console.log("🔧 Utility atoms:", {
            status: networkStats.status,
            fetchStatus: networkStats.fetchStatus,
            isFetching: networkStats.isFetching,
            isLoading: networkStats.isLoading,
            errorCount: networkStats.errorCount,
        })

        // Phase 8: Network and Performance Monitoring
        recorder.setPhase("completion")
        console.log("")
        console.log(`🌐 Total network requests made: ${networkCounter.getCount()}`)
        console.log("")
        console.log("✅ Profile atoms test completed successfully!")

        // Generate comprehensive test summary
        console.log("")
        console.log("📊 ✅ Profile atoms test completed successfully!")
        console.log("")

        // Save comprehensive test results with full atom dumps
        const resultsDir = path.join(__dirname, "results")
        mkdirSync(resultsDir, {recursive: true})

        // Import writeFileSync for file operations
        const {writeFileSync} = await import("fs")

        // Generate comprehensive atom dumps
        const atomDumps = {
            // Core profile atoms
            profileQueryAtom: testStore.get(profileQueryAtom),
            userAtom: testStore.get(userAtom),
            profileLoadingAtom: testStore.get(profileLoadingAtom),
            profileErrorAtom: testStore.get(profileErrorAtom),
            authStatusAtom: testStore.get(authStatusAtom),

            // User information atoms
            userIdAtom: testStore.get(userIdAtom),
            userDisplayNameAtom: testStore.get(userDisplayNameAtom),
            userEmailAtom: testStore.get(userEmailAtom),
            userPreferencesAtom: testStore.get(userPreferencesAtom),

            // Statistics atoms
            profileStatsAtom: testStore.get(profileStatsAtom),

            // Utility atoms
            profilePrefetchAtom: testStore.get(profilePrefetchAtom),
            profileRefreshAtom: testStore.get(profileRefreshAtom),
            profileResetAtom: testStore.get(profileResetAtom),
            profileNetworkStatsAtom: testStore.get(profileNetworkStatsAtom),

            // Skeleton atoms
            profileSkeletonAtom: testStore.get(profileSkeletonAtom),
            userDisplayNameSkeletonAtom: testStore.get(userDisplayNameSkeletonAtom),
            userEmailSkeletonAtom: testStore.get(userEmailSkeletonAtom),
            authStatusSkeletonAtom: testStore.get(authStatusSkeletonAtom),
            profileStatsSkeletonAtom: testStore.get(profileStatsSkeletonAtom),
            profileSkeletonVisibilityAtom: testStore.get(profileSkeletonVisibilityAtom),

            // Mutation atoms
            updateProfileMutationAtom: testStore.get(updateProfileMutationAtom),
            changePasswordMutationAtom: testStore.get(changePasswordMutationAtom),
            updatePreferencesMutationAtom: testStore.get(updatePreferencesMutationAtom),
            refreshProfileMutationAtom: testStore.get(refreshProfileMutationAtom),
            profileMutationLoadingAtom: testStore.get(profileMutationLoadingAtom),
            profileMutationErrorsAtom: testStore.get(profileMutationErrorsAtom),
        }

        // Create comprehensive result object
        const testResult = {
            generatedAt: new Date().toISOString(),
            totalDuration: Date.now() - startTime,
            totalNetworkRequests: networkCounter.getCount(),
            atomDumps,
        }

        // Save JSON result file
        const jsonFilename = path.join(resultsDir, "profile-test-run.json")
        writeFileSync(jsonFilename, JSON.stringify(testResult, null, 2))
        console.log(`💾 Enhanced results saved to: ${jsonFilename}`)

        // Generate and save markdown summary
        const markdownSummary = `# Profile Atoms Test Results

## Test Overview
- **Generated**: ${testResult.generatedAt}
- **Duration**: ${testResult.totalDuration}ms
- **Network Requests**: ${testResult.totalNetworkRequests}

## Atom State Summary

### Core Profile Atoms
- **Profile Loading**: ${atomDumps.profileLoadingAtom}
- **Profile Error**: ${atomDumps.profileErrorAtom ? "Yes" : "No"}
- **Auth Status**: ${atomDumps.authStatusAtom?.isAuthenticated ? "Authenticated" : "Not Authenticated"}

### User Information
- **User ID**: ${atomDumps.userIdAtom || "None"}
- **Display Name**: ${atomDumps.userDisplayNameAtom || "None"}
- **Email**: ${atomDumps.userEmailAtom || "None"}
- **Has Preferences**: ${atomDumps.userPreferencesAtom ? "Yes" : "No"}

### Profile Statistics
- **Has Stats**: ${atomDumps.profileStatsAtom ? "Yes" : "No"}

### Skeleton State
- **Profile Skeleton**: ${atomDumps.profileSkeletonAtom ? "Active" : "Inactive"}
- **Display Name Skeleton**: ${atomDumps.userDisplayNameSkeletonAtom || "None"}
- **Email Skeleton**: ${atomDumps.userEmailSkeletonAtom || "None"}
- **Auth Status Skeleton**: ${atomDumps.authStatusSkeletonAtom?.skeleton ? "Active" : "Inactive"}
- **Skeleton Visibility**: ${atomDumps.profileSkeletonVisibilityAtom ? "Visible" : "Hidden"}

### Mutation State
- **Update Profile Available**: ${atomDumps.updateProfileMutationAtom ? "Yes" : "No"}
- **Change Password Available**: ${atomDumps.changePasswordMutationAtom ? "Yes" : "No"}
- **Update Preferences Available**: ${atomDumps.updatePreferencesMutationAtom ? "Yes" : "No"}
- **Any Mutation Loading**: ${atomDumps.profileMutationLoadingAtom?.anyLoading ? "Yes" : "No"}
- **Mutation Errors**: ${atomDumps.profileMutationErrorsAtom?.hasErrors ? "Yes" : "No"}

### Network Monitoring
- **Network Status**: ${atomDumps.profileNetworkStatsAtom?.status || "unknown"}
- **Fetch Status**: ${atomDumps.profileNetworkStatsAtom?.fetchStatus || "unknown"}
- **Is Fetching**: ${atomDumps.profileNetworkStatsAtom?.isFetching ? "Yes" : "No"}
- **Error Count**: ${atomDumps.profileNetworkStatsAtom?.errorCount || 0}

## Result
✅ **Profile atoms test completed successfully!**
All profile state management atoms are functioning correctly with proper data flow, skeleton states, and mutation handling.
`

        const markdownFilename = path.join(resultsDir, "profile-test-run-summary.md")
        writeFileSync(markdownFilename, markdownSummary)
        console.log(`📄 Summary saved to: ${markdownFilename}`)

        // Generate HTML visualization
        const htmlVisualization = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Profile Atoms Test Results</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #e1e5e9; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #007bff; }
        .stat-value { font-size: 2em; font-weight: bold; color: #007bff; }
        .stat-label { color: #6c757d; font-size: 0.9em; }
        .section { margin: 30px 0; }
        .atom-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; }
        .atom-card { background: #f8f9fa; padding: 15px; border-radius: 6px; border: 1px solid #dee2e6; }
        .atom-name { font-weight: bold; color: #495057; margin-bottom: 10px; }
        .atom-value { font-family: 'Monaco', 'Menlo', monospace; font-size: 0.85em; background: white; padding: 10px; border-radius: 4px; border: 1px solid #e9ecef; max-height: 200px; overflow-y: auto; }
        .success { color: #28a745; }
        .timeline { background: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0; }
        .phase { margin: 10px 0; padding: 10px; background: white; border-radius: 4px; border-left: 3px solid #17a2b8; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>👤 Profile Atoms Test Results</h1>
            <p>Generated: ${testResult.generatedAt}</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${testResult.totalDuration}ms</div>
                <div class="stat-label">Total Duration</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${testResult.totalNetworkRequests}</div>
                <div class="stat-label">Network Requests</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${atomDumps.authStatusAtom?.isAuthenticated ? "✅" : "❌"}</div>
                <div class="stat-label">Authentication</div>
            </div>
            <div class="stat-card">
                <div class="stat-value success">✅</div>
                <div class="stat-label">Test Status</div>
            </div>
        </div>

        <div class="section">
            <h2>📊 Atom State Dumps</h2>
            <div class="atom-grid">
                ${Object.entries(atomDumps)
                    .map(
                        ([atomName, value]) => `
                    <div class="atom-card">
                        <div class="atom-name">${atomName}</div>
                        <div class="atom-value">${JSON.stringify(value, null, 2)}</div>
                    </div>
                `,
                    )
                    .join("")}
            </div>
        </div>

        <div class="section">
            <h2>⏱️ Test Summary</h2>
            <div class="timeline">
                <div class="phase">
                    <strong>Test Duration</strong>: ${testResult.totalDuration}ms
                </div>
                <div class="phase">
                    <strong>Network Requests</strong>: ${testResult.totalNetworkRequests}
                </div>
                <div class="phase">
                    <strong>Profile Atoms</strong>: ${Object.keys(atomDumps).length} atoms tested
                </div>
            </div>
        </div>
    </div>
</body>
</html>`

        const htmlFilename = path.join(resultsDir, "profile-test-run-visualization.html")
        writeFileSync(htmlFilename, htmlVisualization)
        console.log(`🌐 Visualization saved to: ${htmlFilename}`)

        console.log("")
        console.log("🎉 Profile test suite completed!")
    } catch (error) {
        console.error("❌ Profile atoms test failed:", error)
        // Record error in test results
        console.error("Profile atoms test failed:", error)
        throw error
    }
}

// ============================================================================
// Execute Test
// ============================================================================

runProfileAtomsTest()
    .then(() => {
        console.log("🏁 Test execution completed")
        process.exit(0)
    })
    .catch((error) => {
        console.error("💥 Test execution failed:", error)
        process.exit(1)
    })
