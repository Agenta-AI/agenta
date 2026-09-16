/**
 * Disconnecting writes the endpoint the server returned straight into the list cache.
 *
 * Refetching instead would leave the row reading Authorized until the round trip landed,
 * which is the wrong thing to say about a credential that is already gone. The row it
 * writes is the whole endpoint, not a merge: the disconnect removed `secret_id`, and
 * merging would put it back.
 */
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

import type {MCPEndpoint} from "../../src/mcpEndpoint/core/types"

const {disconnectMcpEndpoint, queryClient} = vi.hoisted(() => ({
    disconnectMcpEndpoint: vi.fn(),
    queryClient: {current: null as unknown},
}))

vi.mock("../../src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/mcpEndpoint/api/api")>()),
    disconnectMcpEndpoint,
}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    getHostQueryClient: () => queryClient.current,
}))

import {disconnectMcpEndpointAtom, MCP_ENDPOINTS_QUERY_KEY} from "../../src/mcpEndpoint/state/atoms"
import {getMcpConnectionState} from "../../src/mcpEndpoint/core/connectionState"
import {projectIdAtom} from "@agenta/shared/state"

const PROJECT = "project-1"
const KEY = [MCP_ENDPOINTS_QUERY_KEY, PROJECT]

const connected: MCPEndpoint = {
    id: "mcp-1",
    slug: "acme",
    name: "Acme (main)",
    auth_mode: "oauth",
    namespace: "custom",
    secret_id: "grant-1",
    data: {route: {base_url: "https://mcp.acme.test/"}},
}

const other: MCPEndpoint = {
    id: "mcp-2",
    slug: "beta",
    name: "Beta",
    auth_mode: "oauth",
    namespace: "custom",
    secret_id: "grant-2",
    data: {route: {base_url: "https://mcp.beta.test/"}},
}

/** What the route answers: the same endpoint, with the grant gone and nothing else moved. */
const disconnected: MCPEndpoint = {
    id: "mcp-1",
    slug: "acme",
    name: "Acme (main)",
    auth_mode: "oauth",
    namespace: "custom",
    data: {route: {base_url: "https://mcp.acme.test/"}},
}

let client: QueryClient
let store: ReturnType<typeof createStore>

const cachedRows = () => client.getQueryData<MCPEndpoint[]>(KEY)

beforeEach(() => {
    vi.clearAllMocks()
    client = new QueryClient()
    queryClient.current = client
    store = createStore()
    store.set(projectIdAtom, PROJECT)
    disconnectMcpEndpoint.mockResolvedValue({count: 1, endpoint: disconnected})
})

describe("disconnectMcpEndpointAtom", () => {
    it("replaces the disconnected row in the cache without refetching", async () => {
        client.setQueryData(KEY, [connected, other])
        const invalidate = vi.spyOn(client, "invalidateQueries")

        await store.set(disconnectMcpEndpointAtom, "mcp-1")

        expect(disconnectMcpEndpoint).toHaveBeenCalledWith("mcp-1", PROJECT)
        expect(invalidate).not.toHaveBeenCalled()
        expect(cachedRows()?.[0].secret_id).toBeUndefined()
    })

    it("leaves the row's identity, label and address alone", async () => {
        client.setQueryData(KEY, [connected])

        await store.set(disconnectMcpEndpointAtom, "mcp-1")

        const row = cachedRows()?.[0]
        expect(row?.id).toBe("mcp-1")
        expect(row?.slug).toBe("acme")
        expect(row?.name).toBe("Acme (main)")
        expect(row?.data.route.base_url).toBe("https://mcp.acme.test/")
    })

    it("makes the row read as needing authorization, so one Connect reconnects it", async () => {
        client.setQueryData(KEY, [connected])
        expect(getMcpConnectionState(connected)).toBe("ready")

        await store.set(disconnectMcpEndpointAtom, "mcp-1")

        expect(getMcpConnectionState(cachedRows()![0])).toBe("needs_auth")
    })

    it("touches no other connection at the same server", async () => {
        client.setQueryData(KEY, [connected, other])

        await store.set(disconnectMcpEndpointAtom, "mcp-1")

        expect(cachedRows()?.[1]).toEqual(other)
    })

    it("is safe to repeat: a second disconnect writes the same row again", async () => {
        client.setQueryData(KEY, [connected])

        await store.set(disconnectMcpEndpointAtom, "mcp-1")
        await store.set(disconnectMcpEndpointAtom, "mcp-1")

        expect(cachedRows()).toEqual([disconnected])
    })

    it("falls back to a refetch when there is no cached list to write into", async () => {
        const invalidate = vi.spyOn(client, "invalidateQueries")

        await store.set(disconnectMcpEndpointAtom, "mcp-1")

        expect(invalidate).toHaveBeenCalledWith({queryKey: [MCP_ENDPOINTS_QUERY_KEY]})
    })

    it("leaves the cache untouched when the request fails", async () => {
        client.setQueryData(KEY, [connected])
        disconnectMcpEndpoint.mockRejectedValue(new Error("nope"))

        await expect(store.set(disconnectMcpEndpointAtom, "mcp-1")).rejects.toThrow("nope")

        expect(cachedRows()?.[0].secret_id).toBe("grant-1")
    })
})
