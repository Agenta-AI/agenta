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
    fetchVaultSecretMock.mockResolvedValue(VAULT_ROWS)
    fetchSubscriptionStatusMock.mockResolvedValue(null)
    fetchHarnessCapabilitiesMock.mockReset()
})

afterEach(() => {
    client.clear()
})

const load = () =>
    loadAgentModelCandidates({projectId: "proj-1", userId: "user-1", showSubscriptions: false})

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
