/**
 * Integration test store factory.
 *
 * Creates a Jotai store with a real TanStack QueryClient seeded into
 * queryClientAtom so that atomWithQuery atoms can fetch from the network.
 * Also configures the shared axios instance with auth headers if an API
 * key is provided.
 */

import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {axios} from "@agenta/shared/api"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"

import {TEST_CONFIG} from "./env"

export function createIntegrationStore() {
    if (TEST_CONFIG.apiKey) {
        axios.defaults.headers.common["Authorization"] = `ApiKey ${TEST_CONFIG.apiKey}`
    }

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: 0,
                gcTime: 0,
            },
        },
    })

    const store = createStore()
    store.set(queryClientAtom, queryClient)

    // Seed project context — queries gated on projectIdAtom or sessionAtom
    // (e.g. traceSpanMolecule) will not enable without these.
    if (TEST_CONFIG.projectId) {
        store.set(projectIdAtom, TEST_CONFIG.projectId)
        store.set(sessionAtom, true)
    }

    return {store, queryClient}
}

/**
 * Wait for a Jotai atom to satisfy a predicate, or reject on timeout.
 * Useful for waiting for async query atoms to settle.
 */
export function waitForAtom<T>(
    store: ReturnType<typeof createStore>,
    atomArg: Parameters<typeof store.get>[0],
    predicate: (value: T) => boolean,
    timeoutMs = 10_000,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const initial = store.get(atomArg) as T
        if (predicate(initial)) {
            resolve(initial)
            return
        }

        const timer = setTimeout(() => {
            unsub()
            reject(new Error(`waitForAtom timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        const unsub = store.sub(atomArg, () => {
            const value = store.get(atomArg) as T
            if (predicate(value)) {
                clearTimeout(timer)
                unsub()
                resolve(value)
            }
        })
    })
}
