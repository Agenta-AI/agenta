/**
 * Shared Testsetup Utilities
 *
 * Common functionality shared between test-apps.ts and test-revision-centric.ts:
 * - Environment validation and setup
 * - QueryClient configuration
 * - Query tracking and API call recording
 * - Jotai store initialization
 * - Common test patterns and helpers
 */

import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import path from "path"
import {mkdirSync} from "fs"

import {EnhancedTestRecorder} from "./test-analysis"

export interface TestEnvironment {
    projectId?: string
    appId?: string
    apiUrl?: string | undefined
    nodeEnv?: string | undefined
    computedBaseUrl?: string
    jwt?: string
}

export interface QueryTrackingOptions {
    enableLogging?: boolean
    trackPendingQueries?: boolean
    trackCompletedQueries?: boolean
}

/**
 * Validates and sets up test environment variables
 */
export function setupTestEnvironment(
    requiredVars: {
        appId?: boolean
        projectId?: boolean
        jwt?: boolean
    } = {},
): TestEnvironment {
    const environment: TestEnvironment = {
        apiUrl: process.env.NEXT_PUBLIC_AGENTA_API_URL,
        nodeEnv: process.env.NODE_ENV,
    }

    // Validate required variables
    if (requiredVars.appId) {
        const appId = process.env.VITEST_TEST_APP_ID
        if (!appId) {
            console.error("❌ Missing VITEST_TEST_APP_ID environment variable")
            process.exit(1)
        }
        environment.appId = appId
    }

    if (requiredVars.projectId) {
        const projectId =
            process.env.VITEST_TEST_PROJECT_ID || "01988511-c871-71c2-97df-b12386ebe480"
        environment.projectId = projectId
    }

    if (requiredVars.jwt) {
        const jwt = process.env.VITEST_TEST_JWT
        if (!jwt) {
            console.error("❌ Missing VITEST_TEST_JWT environment variable")
            process.exit(1)
        }
        environment.jwt = jwt
    }

    return environment
}

/**
 * Logs environment debug information
 */
export function logEnvironmentDebug(environment: TestEnvironment, testName: string) {
    console.log(`🧪 === ${testName} ===`)
    console.log("🔍 DEBUG - Environment Variables:")
    console.log("  NODE_ENV:", process.env.NODE_ENV)
    console.log("  NEXT_PUBLIC_AGENTA_API_URL:", process.env.NEXT_PUBLIC_AGENTA_API_URL)

    if (environment.appId) {
        console.log("  VITEST_TEST_APP_ID:", process.env.VITEST_TEST_APP_ID)
    }
    if (environment.projectId) {
        console.log("  VITEST_TEST_PROJECT_ID:", process.env.VITEST_TEST_PROJECT_ID)
    }
    if (environment.computedBaseUrl) {
        console.log("🔍 DEBUG - Computed Base URL:", environment.computedBaseUrl)
    }

    console.log("📋 Environment:", environment)
}

/**
 * Creates a configured QueryClient for testing
 */
export function createTestQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {retry: false, staleTime: 0},
        },
    })
}

/**
 * Sets up query tracking with the recorder
 */
export function setupQueryTracking(
    queryClient: QueryClient,
    recorder: EnhancedTestRecorder,
    options: QueryTrackingOptions = {},
): Set<string> {
    const {enableLogging = true, trackPendingQueries = true, trackCompletedQueries = true} = options

    const queryCache = queryClient.getQueryCache()
    const trackedQueries = new Set<string>()

    queryCache.subscribe((event) => {
        if (event.type === "added" && trackPendingQueries) {
            const query = event.query
            const queryKey = query.queryKey
            const endpoint = Array.isArray(queryKey) ? queryKey.join("/") : String(queryKey)

            if (!trackedQueries.has(endpoint)) {
                trackedQueries.add(endpoint)
                recorder.recordApiCall(endpoint, "GET", {
                    queryKey,
                    state: query.state.status,
                    timestamp: Date.now(),
                    status: "pending",
                })

                if (enableLogging) {
                    console.log(`🌐 API Call: ${endpoint}`)
                }
            }
        }

        if (event.type === "updated" && trackCompletedQueries) {
            const query = event.query
            const queryKey = query.queryKey
            const endpoint = Array.isArray(queryKey) ? queryKey.join("/") : String(queryKey)

            if (query.state.status === "success" || query.state.status === "error") {
                recorder.recordApiCall(endpoint, "GET", {
                    queryKey,
                    state: query.state.status,
                    status: query.state.status,
                    dataUpdatedAt: query.state.dataUpdatedAt,
                    error: query.state.error,
                })

                if (enableLogging) {
                    console.log(`📡 Request completed: ${endpoint} (${query.state.status})`)
                }
            }
        }
    })

    return trackedQueries
}

/**
 * Creates and configures a Jotai store with QueryClient
 */
export function createTestStore(queryClient: QueryClient) {
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    return store
}

/**
 * Common test phase setup
 */
export function startTestPhase(
    recorder: EnhancedTestRecorder,
    phaseNumber: string,
    phaseName: string,
    phaseId: string,
) {
    console.log(`\n${phaseNumber} ${phaseName}`)
    recorder.setPhase(phaseId)
}

/**
 * Common wait utility for async operations
 */
export async function waitForCompletion(ms = 2000): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Common pattern for logging sample data
 */
export function logSampleData<T extends Record<string, any>>(
    data: T[],
    title: string,
    formatter: (item: T, index: number) => void,
    maxItems = 3,
) {
    if (data.length > 0) {
        console.log(`🔍 ${title}:`)
        data.slice(0, maxItems).forEach(formatter)
    }
}

/**
 * Common pattern for testing atom subscriptions
 */
export function testAtomSubscription(
    store: any,
    atomName: string,
    atom: any,
    recorder: EnhancedTestRecorder,
    logResult?: (result: any) => void,
) {
    const result = store.get(atom)
    recorder.recordAtomSubscription(atomName, "loaded", result)

    if (logResult) {
        logResult(result)
    }

    return result
}

/**
 * Common test completion and cleanup
 */
export async function completeTest(
    recorder: EnhancedTestRecorder,
    testName: string,
    basePath: string,
    summary: string,
) {
    console.log(`\n✅ ${testName} completed successfully!`)
    console.log(`\n📊 ${summary}`)

    // Save test results to the results directory
    const resultsDir = path.join(__dirname, "..", "results")
    mkdirSync(resultsDir, {recursive: true})
    const filename = path.join(resultsDir, `${basePath}.json`)
    await recorder.save(filename)
}

/**
 * Common error handling wrapper
 */
export async function runTestWithErrorHandling<T>(
    testName: string,
    testFn: () => Promise<T>,
): Promise<T | null> {
    try {
        return await testFn()
    } catch (error) {
        console.error(`❌ ${testName} failed:`, error)
        return null
    }
}

/**
 * Common skeleton detection logging helper
 */
export function logSkeletonDetection(atomName: string, data: any) {
    // This pattern is used in both tests for skeleton detection
    if (data && typeof data === "object" && data.length === 0) {
        console.log(`🎭 ${atomName}: Skeleton data detected (${data.length} items)`)
    }
}

/**
 * Network request counter utility
 */
export class NetworkRequestCounter {
    private count = 0

    increment() {
        this.count++
    }

    getCount(): number {
        return this.count
    }

    logTotal() {
        console.log(`🌐 Total network requests made: ${this.count}`)
    }
}
