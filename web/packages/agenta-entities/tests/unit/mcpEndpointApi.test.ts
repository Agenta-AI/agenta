import {beforeEach, describe, expect, it, vi} from "vitest"

import {axios} from "@agenta/shared/api"

import {
    beginMcpConnect,
    discoverMcpConnect,
    disconnectMcpEndpoint,
    editMcpEndpoint,
    listMcpTools,
    queryMcpEndpoints,
} from "../../src/mcpEndpoint/api/api"

vi.mock("@agenta/shared/api", () => ({
    axios: {get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn()},
    getAgentaApiUrl: vi.fn(() => "https://api.example.test"),
}))

const BASE = "https://api.example.test/gateways/mcps/endpoints"

describe("mcpEndpoints api", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("discoverMcpConnect posts an empty body — the discover step", async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: {count: 1, scopes_offered: ["read", "write"]},
        })

        const result = await discoverMcpConnect("endpoint-1", "project-1")

        expect(axios.post).toHaveBeenCalledWith(
            `${BASE}/endpoint-1/connect`,
            {},
            {params: {project_id: "project-1"}},
        )
        expect(result.scopes_offered).toEqual(["read", "write"])
    })

    it("beginMcpConnect posts the chosen scopes — the begin step", async () => {
        vi.mocked(axios.post).mockResolvedValue({
            data: {count: 1, redirect_url: "https://auth.example.test/authorize"},
        })

        const result = await beginMcpConnect("endpoint-1", ["read"], "project-1")

        expect(axios.post).toHaveBeenCalledWith(
            `${BASE}/endpoint-1/connect`,
            {scopes: ["read"]},
            {params: {project_id: "project-1"}},
        )
        expect(result.redirect_url).toBe("https://auth.example.test/authorize")
    })

    it("beginMcpConnect allows an empty scope list through unchanged", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: {count: 1, redirect_url: "x"}})

        await beginMcpConnect("endpoint-1", [], "project-1")

        expect(axios.post).toHaveBeenCalledWith(
            `${BASE}/endpoint-1/connect`,
            {scopes: []},
            {params: {project_id: "project-1"}},
        )
    })

    it("editMcpEndpoint PUTs to the endpoint's own id", async () => {
        vi.mocked(axios.put).mockResolvedValue({data: {count: 1, endpoint: {id: "endpoint-1"}}})

        await editMcpEndpoint(
            {
                id: "endpoint-1",
                auth_mode: "oauth",
                secret_id: "secret-1",
                data: {route: {base_url: "https://mcp.example.com"}},
            },
            "project-1",
        )

        expect(axios.put).toHaveBeenCalledWith(
            `${BASE}/endpoint-1`,
            {
                endpoint: {
                    id: "endpoint-1",
                    auth_mode: "oauth",
                    secret_id: "secret-1",
                    data: {route: {base_url: "https://mcp.example.com"}},
                },
            },
            {params: {project_id: "project-1"}},
        )
    })

    it("omits the project id param when absent", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: {count: 1, scopes_offered: []}})

        await discoverMcpConnect("endpoint-1")

        expect(axios.post).toHaveBeenCalledWith(
            `${BASE}/endpoint-1/connect`,
            {},
            {params: undefined},
        )
    })
})

describe("disconnectMcpEndpoint", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("DELETEs the endpoint's connect resource, not the endpoint", async () => {
        vi.mocked(axios.delete).mockResolvedValue({
            data: {count: 1, endpoint: {id: "endpoint-1", slug: "acme"}},
        })

        const result = await disconnectMcpEndpoint("endpoint-1", "project-1")

        expect(axios.delete).toHaveBeenCalledWith(`${BASE}/endpoint-1/connect`, {
            params: {project_id: "project-1"},
        })
        // The row survives: disconnecting takes the credential, deleting takes the identity.
        expect(result.endpoint?.slug).toBe("acme")
    })

    it("returns the endpoint with no grant, which reads as needing authorization", async () => {
        vi.mocked(axios.delete).mockResolvedValue({
            data: {count: 1, endpoint: {id: "endpoint-1", auth_mode: "oauth"}},
        })

        const result = await disconnectMcpEndpoint("endpoint-1", "project-1")

        expect(result.endpoint?.secret_id).toBeUndefined()
    })
})

describe("queryMcpEndpoints", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("asks the query route, which answers from stored rows only", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: {count: 1, endpoints: []}})

        await queryMcpEndpoints("project-1")

        expect(axios.post).toHaveBeenCalledWith(
            `${BASE}/query`,
            {},
            {params: {project_id: "project-1"}},
        )
    })
})

describe("listMcpTools", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const mintAndHandshake = (sessionId?: string) => {
        vi.mocked(axios.post).mockImplementation((async (url: string) => {
            if (url.endsWith("/gateways/credentials")) {
                return {data: {credentials: "Secret token"}}
            }
            const call = vi.mocked(axios.post).mock.calls.length
            if (call === 2) {
                return {
                    data: {jsonrpc: "2.0", id: 1, result: {}},
                    headers: sessionId ? {"mcp-session-id": sessionId} : {},
                }
            }
            return {
                data: {
                    jsonrpc: "2.0",
                    id: 2,
                    result: {tools: [{name: "search", description: "Find things"}, {}]},
                },
                headers: {},
            }
        }) as never)
    }

    it("mints a gateway credential, handshakes, then lists", async () => {
        mintAndHandshake()

        const tools = await listMcpTools("acme", "project-1")

        const calls = vi.mocked(axios.post).mock.calls
        expect(calls[0][0]).toContain("/gateways/credentials")
        expect((calls[1][1] as {method: string}).method).toBe("initialize")
        expect((calls[2][1] as {method: string}).method).toBe("tools/list")
        // The data plane reads X-AG-Credentials and ignores Authorization.
        expect((calls[1][2] as {headers: Record<string, string>}).headers["X-AG-Credentials"]).toBe(
            "Secret token",
        )
        // A tool with no name is not a tool.
        expect(tools).toEqual([{name: "search", description: "Find things"}])
    })

    it("carries the session id a stateful server hands back", async () => {
        mintAndHandshake("session-9")

        await listMcpTools("acme", "project-1")

        const listCall = vi.mocked(axios.post).mock.calls[2]
        expect((listCall[2] as {headers: Record<string, string>}).headers["mcp-session-id"]).toBe(
            "session-9",
        )
    })

    it("reports an empty tool list rather than inventing one", async () => {
        vi.mocked(axios.post).mockImplementation((async (url: string) => {
            if (url.endsWith("/gateways/credentials")) {
                return {data: {credentials: "Secret token"}}
            }
            return {data: {jsonrpc: "2.0", result: {}}, headers: {}}
        }) as never)

        expect(await listMcpTools("acme", "project-1")).toEqual([])
    })
})
