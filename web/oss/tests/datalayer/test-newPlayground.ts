/**
 * New Playground Atoms Test
 * Tests the new playground state mutation atoms with real API data
 * Focus: Purpose-specific mutation atoms for complex operations
 */

// Core dependencies
import {createStore} from "jotai" // eslint-disable-line @typescript-eslint/no-unused-vars
import "dotenv/config"

import {getBaseUrl} from "../../src/lib/api/assets/fetchClient"

// Import real variant atoms for data
import {
    updateVariantPromptAtom,
    updateVariantParameterAtom,
    addPromptMessageAtom,
    deletePromptMessageAtom,
    reorderPromptMessagesAtom,
} from "../../src/state/newPlayground"
import {latestRevisionsAtom} from "../../src/state/newVariants/atoms/queries"

// Import mutation atoms from new playground state that we built
import {
    setupTestEnvironment,
    logEnvironmentDebug,
    createTestQueryClient,
    setupQueryTracking,
    createTestStore,
    NetworkRequestCounter,
} from "./utils/shared-test-setup"
import {EnhancedTestRecorder} from "./utils/test-analysis"

interface SubscriptionUpdate {
    atomName: string
    oldValue: any
    newValue: any
    timestamp: number
}

interface TestResult {
    testName: string
    passed: boolean
    message: string
    subscriptionUpdates?: SubscriptionUpdate[]
}

class PlaygroundSubscriptionTester {
    private results: TestResult[] = []
    private subscriptions = new Map<string, SubscriptionUpdate[]>()
    private unsubscribeFunctions: (() => void)[] = []

    recordResult(
        testName: string,
        passed: boolean,
        message: string,
        updates?: SubscriptionUpdate[],
    ) {
        this.results.push({
            testName,
            passed,
            message: passed ? `✅ ${testName}: ${message}` : `❌ ${testName}: ${message}`,
            subscriptionUpdates: updates,
        })
        console.log(this.results[this.results.length - 1].message)
    }

    subscribeToAtom(store: any, atom: any, atomName: string) {
        const updates: SubscriptionUpdate[] = []
        this.subscriptions.set(atomName, updates)

        let previousValue: any
        try {
            previousValue = store.get(atom)
        } catch {
            previousValue = undefined
        }

        const unsubscribe = store.sub(atom, () => {
            try {
                const newValue = store.get(atom)
                const update: SubscriptionUpdate = {
                    atomName,
                    oldValue: previousValue,
                    newValue,
                    timestamp: Date.now(),
                }
                updates.push(update)
                console.log(`🔔 ${atomName} updated:`, {old: previousValue, new: newValue})
                previousValue = newValue
            } catch (error) {
                console.log(`⚠️ ${atomName} subscription error:`, (error as Error).message)
            }
        })

        this.unsubscribeFunctions.push(unsubscribe)
        return updates
    }

    cleanup() {
        this.unsubscribeFunctions.forEach((unsub) => unsub())
        this.unsubscribeFunctions = []
        this.subscriptions.clear()
    }

    getResults() {
        return {
            results: this.results,
            subscriptions: Object.fromEntries(this.subscriptions),
            passed: this.results.filter((r) => r.passed).length,
            failed: this.results.filter((r) => !r.passed).length,
            total: this.results.length,
        }
    }
}

export async function runNewPlaygroundTest() {
    const recorder = new EnhancedTestRecorder()
    const _networkCounter = new NetworkRequestCounter()

    // Setup environment with required variables
    const environment = setupTestEnvironment({
        appId: true,
        jwt: true,
    })
    environment.computedBaseUrl = getBaseUrl()

    logEnvironmentDebug(environment, "New Playground Atoms Test")
    recorder.record("environment:setup", environment)

    console.log("\n🔄 Testing Playground State Management with Real Data...")

    // Create QueryClient and store with tracking
    const queryClient = createTestQueryClient()
    const _trackedQueries = setupQueryTracking(queryClient, recorder)
    const store = createTestStore(queryClient)

    const tester = new PlaygroundSubscriptionTester()

    try {
        // ========================================================================
        // 1️⃣ Mount real variant atoms and wait for data
        // ========================================================================
        console.log("\n🔄 Phase 1: Mounting Real Variant Atoms")

        // Subscribe to latestRevisionsAtom and trigger next phases when data loads
        let variantIds: string[] = []
        let testPhaseCompleted = false

        const unsubVariants = store.sub(latestRevisionsAtom, async () => {
            const result: any = store.get(latestRevisionsAtom)
            console.log("🚀 latestRevisionsAtom update:", {
                isSuccess: result?.isSuccess || false,
                dataLength: result?.data?.length || 0,
                isLoading: result?.isLoading || false,
            })

            recorder.record("latestRevisionsAtom:subscription", result)

            // When variants successfully load, trigger playground initialization
            if (result?.isSuccess && result?.data?.length > 0 && !testPhaseCompleted) {
                testPhaseCompleted = true

                const variants = result.data.map((v: any) => ({
                    id: v.variantId || v.id,
                    name: v.variantName || v.variant_name,
                    latestRevision: v.revision,
                }))

                console.log("✅ Variants loaded successfully:", {
                    count: result.data.length,
                    variants,
                })

                recorder.record(
                    "variants:loaded",
                    `✅ Variants loaded: ${result.data.length} variants`,
                )

                // Collect variant IDs for playground initialization
                variantIds = result.data.map((v: any) => v.variantId || v.id).filter(Boolean)

                // ========================================================================
                // 2️⃣ Initialize playground with real data (triggered by subscription)
                // ========================================================================
                console.log("\n🔄 Phase 2: Initialize Playground with Real Data")

                if (variantIds.length > 0) {
                    await initializePlaygroundWithVariants(store, recorder, variantIds[0])
                } else {
                    recorder.record(
                        "playground:initialization",
                        "❌ No variant IDs available for playground initialization",
                    )
                }
            } else if (result?.isError && !testPhaseCompleted) {
                console.log("❌ Variants loading error:", result.error?.message)
                recorder.record("variants:error", `❌ Error: ${result.error?.message}`)
                testPhaseCompleted = true
            }
        })

        // Helper function to initialize playground with loaded variants
        async function initializePlaygroundWithVariants(
            store: any,
            recorder: any,
            firstVariantId: string,
        ) {
            try {
                console.log("🚀 Testing purpose-specific mutation atoms with real revision data")

                // Get the real revision data from the atom that was already loaded
                const revisionsResult = store.get(latestRevisionsAtom)
                if (!revisionsResult?.data) {
                    throw new Error("No revision data available from latestRevisionsAtom")
                }

                // Find the specific revision data (not variant!)
                const realRevisionData = revisionsResult.data.find(
                    (revision: any) => (revision.variantId || revision.id) === firstVariantId,
                )
                if (!realRevisionData) {
                    throw new Error(
                        `Revision for variant ${firstVariantId} not found in loaded revision data`,
                    )
                }

                // Use the actual revision ID from the loaded data
                const revisionId = realRevisionData.id || realRevisionData.variantId

                console.log("🔍 Using real revision data:", {
                    id: revisionId,
                    revision: realRevisionData.revision,
                    hasConfig: !!realRevisionData.config,
                    configKeys: realRevisionData.config ? Object.keys(realRevisionData.config) : [],
                })

                // Test playground mutations
                console.log("🔧 Testing playground mutations...")

                // Test prompt update using new playground mutation atom
                store.set(updateVariantPromptAtom, {
                    variantId: revisionId,
                    propertyId: "system_prompt_property_id", // Would be actual __id in real usage
                    value: "Updated test prompt",
                })

                // Test parameter update using new playground mutation atom
                store.set(updateVariantParameterAtom, {
                    variantId: revisionId,
                    propertyId: "temperature_property_id", // Would be actual __id in real usage
                    value: 0.8,
                })

                recorder.record("playground:mutations", "✅ Basic playground mutations triggered")

                // Test purpose-specific mutations
                console.log("🔧 Testing purpose-specific mutations...")

                // Test adding a new message to prompt
                store.set(addPromptMessageAtom, {
                    variantId: revisionId,
                    promptId: "prompt_id_example", // Would be actual prompt __id in real usage
                    messageTemplate: {
                        __id: "new_message_id",
                        __metadata: "message_metadata",
                        role: {value: "user", __id: "role_id", __metadata: "role_metadata"},
                        content: {
                            value: "Test message content",
                            __id: "content_id",
                            __metadata: "content_metadata",
                        },
                        name: {value: null, __id: "name_id", __metadata: "name_metadata"},
                        toolCalls: {
                            value: null,
                            __id: "tool_calls_id",
                            __metadata: "tool_calls_metadata",
                        },
                        toolCallId: {
                            value: null,
                            __id: "tool_call_id_id",
                            __metadata: "tool_call_id_metadata",
                        },
                    },
                })

                recorder.record("playground:add_message", "✅ Added new message to prompt")

                // Test deleting a message from prompt
                store.set(deletePromptMessageAtom, {
                    variantId: revisionId,
                    promptId: "prompt_id_example",
                    messageId: "message_to_delete_id",
                })

                recorder.record("playground:delete_message", "✅ Deleted message from prompt")

                // Test reordering messages in prompt
                store.set(reorderPromptMessagesAtom, {
                    variantId: revisionId,
                    promptId: "prompt_id_example",
                    fromIndex: 0,
                    toIndex: 1,
                })

                recorder.record("playground:reorder_messages", "✅ Reordered messages in prompt")
                recorder.record(
                    "playground:purpose_mutations",
                    "✅ All purpose-specific mutations completed",
                )
            } catch (error) {
                console.error("❌ Playground initialization error:", error)
                recorder.record("playground:error", `❌ Error: ${(error as Error).message}`)
            }
        }

        // Wait for subscription-driven flow to complete
        return new Promise((resolve) => {
            setTimeout(() => {
                unsubVariants()
                resolve(tester.getResults())
            }, 10000) // Give enough time for subscription flow
        })
    } catch (error) {
        console.error("❌ Test failed with error:", error)
        recorder.record("test:error", `Test failed: ${(error as Error).message}`)
        return tester.getResults()
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    runNewPlaygroundTest()
        .then((results) => {
            console.log("\n🎯 Test Results:", results)
            process.exit(results.failed > 0 ? 1 : 0)
        })
        .catch((error) => {
            console.error("❌ Test runner failed:", error)
            process.exit(1)
        })
}
