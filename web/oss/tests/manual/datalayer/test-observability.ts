/**
 * Observability Atoms Test
 *
 * Minimal verification of observability state logic using Jotai atoms.
 */

import "dotenv/config"

import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {routerAppIdAtom} from "../../src/state/app/atoms/fetcher"

import {
    tracesQueryAtom,
    tracesAtom,
    traceCountAtom,
    tracesWithAnnotationsAtom,
    observabilityLoadingAtom,
} from "../../src/state/newObservability/atoms/queries"

import {
    createTestQueryClient,
    NetworkRequestCounter,
    setupTestEnvironment,
    logEnvironmentDebug,
} from "./utils/shared-test-setup"

process.env.NODE_ENV = "test"
const apiUrl =
    process.env.VITEST_TEST_API_URL ||
    process.env.NEXT_PUBLIC_AGENTA_API_URL ||
    "http://localhost/api"
process.env.VITEST_TEST_API_URL = apiUrl
process.env.NEXT_PUBLIC_AGENTA_API_URL = apiUrl
process.env.VITEST_TEST_APP_ID =
    process.env.VITEST_TEST_APP_ID || "01988515-0b61-7163-9f07-92b8b285ba58"
process.env.VITEST_TEST_PROJECT_ID =
    process.env.VITEST_TEST_PROJECT_ID || "01988511-c871-71c2-97df-b12386ebe480"
process.env.VITEST_TEST_JWT = process.env.VITEST_TEST_JWT || "test-jwt"

async function runObservabilityTest() {
    const env = setupTestEnvironment({appId: true, projectId: true, jwt: true})
    logEnvironmentDebug(env, "Observability Atoms Test")

    process.env.VITEST_TEST_APP_ID = env.appId
    process.env.VITEST_TEST_PROJECT_ID = env.projectId
    process.env.VITEST_TEST_JWT = env.jwt

    const queryClient = createTestQueryClient()
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    if (env.appId) store.set(routerAppIdAtom, env.appId)

    const networkCounter = new NetworkRequestCounter()

    let completed = false
    let result: any = null

    const unsubscribe = store.sub(tracesQueryAtom, () => {
        const q = store.get(tracesQueryAtom)
        if (q.status === "success" || q.status === "error") {
            completed = true
            result = q
            networkCounter.increment()
        }
    })

    // trigger query
    store.get(tracesQueryAtom)

    const start = Date.now()
    const timeout = 5000
    while (!completed && Date.now() - start < timeout) {
        await new Promise((r) => setTimeout(r, 100))
    }

    unsubscribe()
    if (!completed) throw new Error("traces query timed out")

    const traces = store.get(tracesAtom) as any[]
    const traceCount = store.get(traceCountAtom)
    const annotated = store.get(tracesWithAnnotationsAtom)
    const loading = store.get(observabilityLoadingAtom)

    console.log("Traces fetched:", traces.length)
    console.log("Trace count:", traceCount)
    console.log("Has annotations:", Array.isArray(annotated) && annotated.length > 0)
    console.log("Loading state:", loading)
    networkCounter.logTotal()

    const fs = await import("fs")
    const path = await import("path")
    const resultsDir = path.join(__dirname, "results")
    fs.mkdirSync(resultsDir, {recursive: true})
    fs.writeFileSync(
        path.join(resultsDir, "observability-test-run.json"),
        JSON.stringify(
            {
                timestamp: new Date().toISOString(),
                traces: traces.length,
                traceCount,
                annotated: annotated.length,
                loading,
                networkRequests: networkCounter.getCount(),
                queryStatus: result.status,
            },
            null,
            2,
        ),
    )
}

runObservabilityTest()
    .then(() => {
        console.log("🏁 Test execution completed")
        process.exit(0)
    })
    .catch((error) => {
        console.error("❌ Test failed:", error)
        process.exit(1)
    })
