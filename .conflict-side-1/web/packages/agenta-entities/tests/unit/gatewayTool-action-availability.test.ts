import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchToolActionDetailMock} = vi.hoisted(() => ({
    fetchToolActionDetailMock: vi.fn(),
}))

vi.mock("../../src/gatewayTool/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/gatewayTool/api")>()
    return {
        ...actual,
        fetchToolActionDetail: fetchToolActionDetailMock,
    }
})

import {
    buildToolActionAvailabilityAtom,
    toolActionAvailabilityKey,
} from "../../src/gatewayTool/hooks/useToolActionAvailability"
import {toolActionDetailQueryFamily} from "../../src/gatewayTool/hooks/useToolActionDetail"

function makeStore() {
    // Instant retries so the transient-error path settles within the test timeout.
    const queryClient = new QueryClient({defaultOptions: {queries: {retryDelay: 1}}})
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    return {store, queryClient}
}

function notFoundError() {
    return Object.assign(new Error("Action not found"), {statusCode: 404})
}

async function waitForAssertion(assertion: () => void) {
    const startedAt = Date.now()
    let lastError: unknown
    while (Date.now() - startedAt < 2000) {
        try {
            assertion()
            return
        } catch (error) {
            lastError = error
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
    throw lastError
}

describe("buildToolActionAvailabilityAtom", () => {
    beforeEach(() => {
        fetchToolActionDetailMock.mockReset()
        toolActionDetailQueryFamily.setShouldRemove(() => true)
        toolActionDetailQueryFamily.setShouldRemove(null)
    })

    it("maps a resolvable action to resolved and a 404 to missing", async () => {
        fetchToolActionDetailMock.mockImplementation(async (_provider, _integration, action) => {
            if (action === "FIND_PULL_REQUESTS") return {count: 1, action: {key: action}}
            throw notFoundError()
        })
        const {store} = makeStore()
        const availability = buildToolActionAvailabilityAtom([
            {integrationKey: "github", actionKey: "FIND_PULL_REQUESTS"},
            {integrationKey: "github", actionKey: "COMMIT_MULTIPLE_FILES"},
        ])

        const unsubscribe = store.sub(availability, () => {})
        try {
            // Both start unknown (probes in flight) — never a false "missing" flash.
            expect(store.get(availability)).toEqual({
                [toolActionAvailabilityKey("github", "FIND_PULL_REQUESTS")]: "unknown",
                [toolActionAvailabilityKey("github", "COMMIT_MULTIPLE_FILES")]: "unknown",
            })
            await waitForAssertion(() => {
                expect(store.get(availability)).toEqual({
                    [toolActionAvailabilityKey("github", "FIND_PULL_REQUESTS")]: "resolved",
                    [toolActionAvailabilityKey("github", "COMMIT_MULTIPLE_FILES")]: "missing",
                })
            })
            // 404 is terminal: no retries burned on a renamed/removed action.
            expect(fetchToolActionDetailMock).toHaveBeenCalledTimes(2)
        } finally {
            unsubscribe()
        }
    })

    it("keeps a transient (non-404) failure unknown instead of marking it missing", async () => {
        fetchToolActionDetailMock.mockRejectedValue(new Error("network down"))
        const {store} = makeStore()
        const availability = buildToolActionAvailabilityAtom([
            {integrationKey: "github", actionKey: "GET_A_PULL_REQUEST"},
        ])

        const unsubscribe = store.sub(availability, () => {})
        try {
            await waitForAssertion(() => {
                // Initial attempt + 3 retries, all failed — the query is settled in error state.
                expect(fetchToolActionDetailMock).toHaveBeenCalledTimes(4)
            })
            await waitForAssertion(() => {
                expect(store.get(availability)).toEqual({
                    [toolActionAvailabilityKey("github", "GET_A_PULL_REQUEST")]: "unknown",
                })
            })
        } finally {
            unsubscribe()
        }
    })

    it("dedupes probes for the same (integration, action) pair", async () => {
        fetchToolActionDetailMock.mockResolvedValue({count: 1, action: {key: "X"}})
        const {store} = makeStore()
        const availability = buildToolActionAvailabilityAtom([
            {integrationKey: "github", actionKey: "X"},
            {integrationKey: "github", actionKey: "X"},
        ])

        const unsubscribe = store.sub(availability, () => {})
        try {
            await waitForAssertion(() => {
                expect(store.get(availability)).toEqual({
                    [toolActionAvailabilityKey("github", "X")]: "resolved",
                })
            })
            expect(fetchToolActionDetailMock).toHaveBeenCalledTimes(1)
        } finally {
            unsubscribe()
        }
    })
})
