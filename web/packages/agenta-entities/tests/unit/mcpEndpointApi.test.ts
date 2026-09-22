import {beforeEach, describe, expect, it, vi} from "vitest"

import {axios} from "@agenta/shared/api"

import {McpProtocolError} from "../../src/mcpEndpoint/core/mcpRpc"
import {gatewayRefusalCode} from "../../src/mcpEndpoint/core/refusal"

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

    it("beginMcpConnect sends registered client credentials only on the begin step", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: {count: 1, redirect_url: "x"}})

        await beginMcpConnect("endpoint-1", ["read"], "project-1", {
            client_id: "registered-client",
            client_secret: "registered-secret",
        })

        expect(axios.post).toHaveBeenCalledWith(
            `${BASE}/endpoint-1/connect`,
            {
                scopes: ["read"],
                oauth_client: {
                    client_id: "registered-client",
                    client_secret: "registered-secret",
                },
            },
            {params: {project_id: "project-1"}},
        )
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

/**
 * The browser's MCP client, checked against the handshake the specification describes and
 * the two in-repo clients that already speak it (`services/runner/src/extensions/pi-mcp.ts`
 * and the backend probe). The cases that matter are the ones where a conversation that did
 * not work would otherwise be presented as a server with nothing to offer.
 */
describe("listMcpTools", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    type Answer = {data: unknown; headers?: Record<string, string>}

    /** A server that answers each method from `answers`, after the credential mint. */
    const server = (answers: Record<string, Answer | Answer[] | Error>) => {
        const pages: Record<string, number> = {}
        vi.mocked(axios.post).mockImplementation((async (url: string, body: unknown) => {
            if (url.endsWith("/gateways/credentials")) {
                return {data: {credentials: "Secret token"}}
            }
            const method = (body as {method: string}).method
            const answer = answers[method]
            if (answer === undefined) return {data: "", headers: {}}
            if (answer instanceof Error) throw answer
            if (Array.isArray(answer)) {
                const index = pages[method] ?? 0
                pages[method] = index + 1
                return {headers: {}, ...answer[Math.min(index, answer.length - 1)]}
            }
            return {headers: {}, ...answer}
        }) as never)
    }

    const handshake = (headers?: Record<string, string>): Answer => ({
        data: {jsonrpc: "2.0", id: 1, result: {protocolVersion: "2025-03-26", capabilities: {}}},
        headers: headers ?? {},
    })

    const sent = () =>
        vi
            .mocked(axios.post)
            .mock.calls.filter(([url]) => !String(url).endsWith("/gateways/credentials"))

    it("completes the handshake before it lists: initialize, initialized, tools/list", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": {
                data: {jsonrpc: "2.0", id: 3, result: {tools: [{name: "search"}, {}]}},
            },
        })

        const tools = await listMcpTools("acme", "project-1")

        expect(sent().map(([, body]) => (body as {method: string}).method)).toEqual([
            "initialize",
            "notifications/initialized",
            "tools/list",
        ])
        // A notification carries no id; a request does.
        expect(sent()[1][1]).not.toHaveProperty("id")
        // A tool with no name is not a tool.
        expect(tools).toEqual([{name: "search"}])
    })

    it("declares both answer shapes it can read, and carries the negotiated version onward", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": {data: {jsonrpc: "2.0", id: 3, result: {tools: []}}},
        })

        await listMcpTools("acme", "project-1")

        const headersOf = (index: number) =>
            (sent()[index][2] as {headers: Record<string, string>}).headers
        expect(headersOf(0).Accept).toBe("application/json, text/event-stream")
        // The data plane reads X-AG-Credentials and ignores Authorization.
        expect(headersOf(0)["X-AG-Credentials"]).toBe("Secret token")
        // The server answered 2025-03-26, so that is the version the rest of the session uses.
        expect(headersOf(2)["MCP-Protocol-Version"]).toBe("2025-03-26")
    })

    it("carries the session id a stateful server hands back", async () => {
        server({
            initialize: handshake({"mcp-session-id": "session-9"}),
            "notifications/initialized": {data: ""},
            "tools/list": {data: {jsonrpc: "2.0", id: 3, result: {tools: []}}},
        })

        await listMcpTools("acme", "project-1")

        expect((sent()[2][2] as {headers: Record<string, string>}).headers["mcp-session-id"]).toBe(
            "session-9",
        )
    })

    it("reads an event-stream answer, which the transport allows in place of a JSON body", async () => {
        server({
            initialize: {
                data: 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}\n\n',
            },
            "notifications/initialized": {data: ""},
            "tools/list": {
                data: 'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[{"name":"echo","description":"Echo it back"}]}}\n\n',
            },
        })

        expect(await listMcpTools("acme", "project-1")).toEqual([
            {name: "echo", description: "Echo it back"},
        ])
    })

    it("follows the pages a cursor announces", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": [
                {data: {jsonrpc: "2.0", id: 3, result: {tools: [{name: "one"}], nextCursor: "p2"}}},
                {data: {jsonrpc: "2.0", id: 4, result: {tools: [{name: "two"}]}}},
            ],
        })

        expect(await listMcpTools("acme", "project-1")).toEqual([{name: "one"}, {name: "two"}])
        expect(sent()[3][1]).toMatchObject({method: "tools/list", params: {cursor: "p2"}})
    })

    it("still lists when a server ignores the initialized notification", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": new Error("Request failed with status code 405"),
            "tools/list": {data: {jsonrpc: "2.0", id: 3, result: {tools: [{name: "echo"}]}}},
        })

        expect(await listMcpTools("acme", "project-1")).toEqual([{name: "echo"}])
    })

    it("reports a server's refusal as a failure, in the server's own words", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": {
                data: {
                    jsonrpc: "2.0",
                    id: 3,
                    error: {code: -32000, message: "This connection needs authorization."},
                },
            },
        })

        await expect(listMcpTools("acme", "project-1")).rejects.toThrow(
            "This connection needs authorization.",
        )
    })

    it("reports the gateway's refusal rather than the transport's status line", async () => {
        const refused = Object.assign(new Error("Request failed with status code 403"), {
            response: {
                data: {
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        code: -32000,
                        message: "The MCP gateway is disabled on this deployment.",
                        data: {cause: "mcp_gateway_disabled"},
                    },
                },
            },
        })
        server({initialize: refused})

        await expect(listMcpTools("acme", "project-1")).rejects.toThrow(
            "The MCP gateway is disabled on this deployment.",
        )
    })

    it("carries the gateway's cause on the failure it raises, not just the sentence", async () => {
        // This is the refusal a person meets on the connection they have not authorized yet:
        // 409, no `detail`, the cause stated structurally in the JSON-RPC envelope and repeated
        // into the message as a marker. Everything about the response is lost at the throw, so
        // whatever the caller wants to OFFER has to travel on the error itself (D50).
        const refused = Object.assign(new Error("Request failed with status code 409"), {
            response: {
                data: {
                    jsonrpc: "2.0",
                    id: null,
                    error: {
                        code: -32000,
                        message:
                            "Authorization required for custom/acme ⟦agenta_code:auth_required⟧",
                        data: {cause: "auth_required", requirement: {state: "needs_auth"}},
                    },
                },
            },
        })
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": refused,
        })

        const failure = await listMcpTools("acme", "project-1").catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(McpProtocolError)
        expect((failure as McpProtocolError).code).toBe("auth_required")
        expect(gatewayRefusalCode(failure)).toBe("auth_required")
        // The marker is for the runner; it has no business in a sentence anyone reads.
        expect((failure as McpProtocolError).message).toBe("Authorization required for custom/acme")
    })

    it("carries the cause of a refusal the server answered 200 with", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": {
                data: {
                    jsonrpc: "2.0",
                    id: 3,
                    error: {
                        code: -32000,
                        message: "This connection needs authorization.",
                        data: {cause: "auth_required"},
                    },
                },
            },
        })

        const failure = await listMcpTools("acme", "project-1").catch((error: unknown) => error)

        expect((failure as McpProtocolError).code).toBe("auth_required")
    })

    it("names no cause when nothing refused, so a dead server is not read as an unauthorized one", async () => {
        server({initialize: new Error("Network Error")})

        const failure = await listMcpTools("acme", "project-1").catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(McpProtocolError)
        expect((failure as McpProtocolError).code).toBeNull()
    })

    it("refuses to read an unanswerable conversation as a server with no tools", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": {data: {jsonrpc: "2.0", id: 3, result: {}}},
        })

        await expect(listMcpTools("acme", "project-1")).rejects.toThrow(/tool list was missing/)
    })

    it("reports a server that exposes nothing as exactly that", async () => {
        server({
            initialize: handshake(),
            "notifications/initialized": {data: ""},
            "tools/list": {data: {jsonrpc: "2.0", id: 3, result: {tools: []}}},
        })

        expect(await listMcpTools("acme", "project-1")).toEqual([])
    })
})
