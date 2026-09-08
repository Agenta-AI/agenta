/**
 * Recovery from a harness catalog cached as an empty map, which an older build could persist.
 * Read as a catalog it says nothing is runnable, which is the false add-a-key banner in #6660.
 */
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {fetchHarnessCapabilitiesMock, fetchVaultSecretMock, fetchSubscriptionStatusMock} =
    vi.hoisted(() => ({
        fetchHarnessCapabilitiesMock: vi.fn(),
        fetchVaultSecretMock: vi.fn(),
        fetchSubscriptionStatusMock: vi.fn(),
    }))

vi.mock("../../src/secret/api", () => ({fetchVaultSecret: fetchVaultSecretMock}))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {
        ...actual,
        fetchHarnessCapabilities: fetchHarnessCapabilitiesMock,
        fetchSubscriptionStatus: fetchSubscriptionStatusMock,
    }
})

import {loadAgentModelCandidates} from "../../src/workflow/state/agentModelCandidates"
import {harnessCatalogIsUsable} from "../../src/workflow/state/inspectMeta"

const CATALOG_KEY = ["workflows", "catalog", "harnesses"]
const SUBSCRIPTION_KEY = ["workflows", "runtime", "subscription-status", "claude", "proj-1"]

const CAPABILITIES = {
    pi_core: {
        providers: ["openai"],
        deployments: ["direct"],
        connection_modes: ["agenta"],
        model_selection: "provider/id",
        models: {openai: ["openai/gpt-5"]},
        default_models: {openai: ["openai/gpt-5"]},
    },
}

const VAULT_ROWS = [{id: "openai", type: "provider_key", title: "OpenAI", hasKey: true}]

const store = getDefaultStore()
let client: QueryClient

beforeEach(() => {
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    // Reset before arming: `mockResolvedValue` alone leaves the call counts these tests assert on.
    fetchVaultSecretMock.mockReset().mockResolvedValue(VAULT_ROWS)
    fetchSubscriptionStatusMock.mockReset().mockResolvedValue(null)
    fetchHarnessCapabilitiesMock.mockReset()
})

afterEach(() => {
    client.clear()
})

const load = () =>
    loadAgentModelCandidates({projectId: "proj-1", userId: "user-1", showSubscriptions: false})

const loadWithSubscriptions = () =>
    loadAgentModelCandidates({projectId: "proj-1", userId: "user-1", showSubscriptions: true})

describe("harnessCatalogIsUsable", () => {
    it("accepts a catalog and rejects an empty map", () => {
        expect(harnessCatalogIsUsable(CAPABILITIES)).toBe(true)
        expect(harnessCatalogIsUsable({})).toBe(false)
        expect(harnessCatalogIsUsable(null)).toBe(false)
        expect(harnessCatalogIsUsable(undefined)).toBe(false)
    })
})

describe("loadAgentModelCandidates with an empty catalog in the cache", () => {
    it("refetches it and recovers once the server answers properly", async () => {
        // `ensureQueryData` serves whatever is cached, so without the refetch a retry after the
        // server recovered would make no request and keep reporting nothing runnable.
        client.setQueryData(CATALOG_KEY, {})
        fetchHarnessCapabilitiesMock.mockResolvedValue(CAPABILITIES)

        const state = await load()

        expect(fetchHarnessCapabilitiesMock).toHaveBeenCalledTimes(1)
        expect(state.status).toBe("ready")
        expect(state.candidates.length).toBeGreaterThan(0)
    })

    it("reports the failure when the refetch fails too", async () => {
        client.setQueryData(CATALOG_KEY, {})
        fetchHarnessCapabilitiesMock.mockRejectedValue(new Error("catalog unavailable"))

        const state = await load()

        expect(fetchHarnessCapabilitiesMock).toHaveBeenCalledTimes(1)
        expect(state.status).toBe("error")
        expect(state.candidates).toEqual([])
    })

    it("serves a usable cached catalog without refetching", async () => {
        client.setQueryData(CATALOG_KEY, CAPABILITIES)

        const state = await load()

        expect(fetchHarnessCapabilitiesMock).not.toHaveBeenCalled()
        expect(state.status).toBe("ready")
    })
})

describe("loadAgentModelCandidates with an unreadable subscription answer cached", () => {
    it("refetches it instead of serving the null forever", async () => {
        client.setQueryData(CATALOG_KEY, CAPABILITIES)
        client.setQueryData(SUBSCRIPTION_KEY, null)
        fetchSubscriptionStatusMock.mockResolvedValue({
            runner: "connected",
            checked_at: null,
            harnesses: {},
        })

        const state = await loadWithSubscriptions()

        expect(fetchSubscriptionStatusMock).toHaveBeenCalledTimes(1)
        expect(state.subscriptionUnknown).toBe(false)
    })

    it("refetches a cached incompatible runner too", async () => {
        // The service answers `incompatible` for a runner it could not read. Serving that from
        // cache would keep a recovered runner invisible to every retry.
        client.setQueryData(CATALOG_KEY, CAPABILITIES)
        client.setQueryData(SUBSCRIPTION_KEY, {runner: "incompatible", checked_at: null})
        fetchSubscriptionStatusMock.mockResolvedValue({
            runner: "connected",
            checked_at: null,
            harnesses: {},
        })

        const state = await loadWithSubscriptions()

        expect(fetchSubscriptionStatusMock).toHaveBeenCalledTimes(1)
        expect(state.subscriptionUnknown).toBe(false)
    })

    it("reports it as unknown when the refetch is unreadable too", async () => {
        client.setQueryData(CATALOG_KEY, CAPABILITIES)
        client.setQueryData(SUBSCRIPTION_KEY, null)
        fetchSubscriptionStatusMock.mockResolvedValue(null)

        const state = await loadWithSubscriptions()

        expect(state.status).toBe("ready")
        expect(state.subscriptionUnknown).toBe(true)
    })
})
