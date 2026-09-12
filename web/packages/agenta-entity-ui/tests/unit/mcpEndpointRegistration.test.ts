/**
 * The agent config panel registers every MCP server it saves as a gateway endpoint, because the
 * SDK resolver routes a declared server to `gateways/mcps/custom/{name}` and drops the author's
 * URL. These cases pin the slug derivation and the two registration payloads: if the slug the
 * item carries and the slug the row is stored under ever diverge, the run 404s at the gateway.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
const invalidateQueries = vi.fn()

vi.mock("@agenta/shared/api", () => ({
    axios: {
        get: (...args: unknown[]) => get(...args),
        post: (...args: unknown[]) => post(...args),
        put: (...args: unknown[]) => put(...args),
    },
    getAgentaApiUrl: () => "https://api.test",
    getHostQueryClient: () => ({invalidateQueries}),
}))

import {
    buildMcpEndpointCreate,
    buildMcpEndpointEdit,
    deriveMcpEndpointSlug,
    mcpEndpointAuthMode,
    mcpEndpointRegistrationFromDraft,
    registerMcpServerDraft,
    registrationErrorDetail,
} from "../../src/DrillInView/SchemaControls/agentTemplate/mcpEndpointRegistration"

beforeEach(() => {
    get.mockReset()
    post.mockReset()
    put.mockReset()
    invalidateQueries.mockReset()
    get.mockResolvedValue({data: {endpoints: []}})
})

describe("deriveMcpEndpointSlug", () => {
    it("keeps a name that is already URL-safe verbatim", () => {
        expect(deriveMcpEndpointSlug("gw-mock-mcp")).toBe("gw-mock-mcp")
        expect(deriveMcpEndpointSlug("Exa_Search.v2")).toBe("Exa_Search.v2")
    })

    it("replaces each run of unsafe characters with a single dash", () => {
        expect(deriveMcpEndpointSlug("Acme  Notion!")).toBe("Acme-Notion-")
        expect(deriveMcpEndpointSlug("  padded  ")).toBe("padded")
    })

    it("drops a leading dot, which the backend slug validator rejects", () => {
        expect(deriveMcpEndpointSlug(".hidden")).toBe("hidden")
        expect(deriveMcpEndpointSlug("-leading-dash")).toBe("-leading-dash")
    })

    it("returns an empty slug for a name with nothing safe in it", () => {
        expect(deriveMcpEndpointSlug("")).toBe("")
        expect(deriveMcpEndpointSlug("   ")).toBe("")
    })

    it("truncates to the backend's 128-character limit", () => {
        expect(deriveMcpEndpointSlug("a".repeat(200))).toHaveLength(128)
    })
})

describe("mcpEndpointAuthMode", () => {
    it("maps the drawer's authentication choice onto the endpoint auth mode", () => {
        expect(mcpEndpointAuthMode("none")).toBe("none")
        expect(mcpEndpointAuthMode("header_secret_refs")).toBe("api_key")
        expect(mcpEndpointAuthMode("oauth")).toBe("oauth")
        expect(mcpEndpointAuthMode(undefined)).toBe("none")
    })
})

describe("mcpEndpointRegistrationFromDraft", () => {
    it("reads the slug, URL, and auth mode off a drafted server", () => {
        expect(
            mcpEndpointRegistrationFromDraft({
                name: "gw-mock-mcp",
                connection: {
                    type: "http",
                    url: "https://mcp.example.com/mcp",
                    credentials: {type: "header_secret_refs", headers: {"x-api-key": "exa"}},
                },
            }),
        ).toEqual({
            slug: "gw-mock-mcp",
            name: "gw-mock-mcp",
            baseUrl: "https://mcp.example.com/mcp",
            authMode: "api_key",
        })
    })

    it("registers nothing for a draft with no URL", () => {
        expect(
            mcpEndpointRegistrationFromDraft({name: "exa", connection: {type: "http", url: ""}}),
        ).toBeNull()
        expect(mcpEndpointRegistrationFromDraft({name: "exa"})).toBeNull()
    })

    it("registers nothing for a server that already names a registered gateway route", () => {
        expect(
            mcpEndpointRegistrationFromDraft({
                name: "exa",
                connection: {type: "gateway", namespace: "custom", slug: "exa"},
            }),
        ).toBeNull()
    })
})

describe("registration payloads", () => {
    const registration = {
        slug: "acme-notion",
        name: "Acme Notion",
        baseUrl: "https://mcp.acme.test/mcp",
        authMode: "api_key" as const,
    }

    it("builds the create body the endpoints API expects", () => {
        expect(buildMcpEndpointCreate(registration)).toEqual({
            slug: "acme-notion",
            name: "Acme Notion",
            auth_mode: "api_key",
            data: {route: {base_url: "https://mcp.acme.test/mcp"}},
        })
    })

    it("falls back to the slug when the server has no display name", () => {
        expect(buildMcpEndpointCreate({...registration, name: ""}).name).toBe("acme-notion")
    })

    it("updates an existing row in place, carrying the rest of its stored route over", () => {
        expect(
            buildMcpEndpointEdit(registration, {
                id: "row-1",
                slug: "acme-notion",
                auth_mode: "none",
                secret_id: "secret-9",
                data: {
                    route: {base_url: "https://old.test/mcp", headers: {"x-tenant": "acme"}},
                },
            }),
        ).toEqual({
            id: "row-1",
            name: "Acme Notion",
            auth_mode: "api_key",
            secret_id: "secret-9",
            data: {
                route: {base_url: "https://mcp.acme.test/mcp", headers: {"x-tenant": "acme"}},
            },
        })
    })

    it("never downgrades an OAuth-connected row, which the drawer cannot express", () => {
        const edit = buildMcpEndpointEdit(
            {...registration, authMode: "none"},
            {id: "row-2", auth_mode: "oauth", data: {route: {base_url: "https://old.test/mcp"}}},
        )
        expect(edit.auth_mode).toBe("oauth")
        expect(edit.secret_id).toBeNull()
    })
})

describe("registerMcpServerDraft", () => {
    const draft = {
        name: "Acme Notion",
        connection: {type: "http", url: "https://mcp.acme.test/mcp", credentials: {type: "none"}},
        policy: {tools: {mode: "all"}},
    }

    it("creates the endpoint and carries the registered slug back as the item name", async () => {
        const saved = await registerMcpServerDraft(draft, "proj-42")

        expect(post).toHaveBeenCalledWith(
            "https://api.test/gateways/mcps/endpoints/",
            {
                endpoint: {
                    slug: "Acme-Notion",
                    name: "Acme Notion",
                    auth_mode: "none",
                    data: {route: {base_url: "https://mcp.acme.test/mcp"}},
                },
            },
            {params: {project_id: "proj-42"}},
        )
        // The name the SDK will put in `gateways/mcps/custom/{name}` IS the registered slug.
        expect(saved.name).toBe("Acme-Notion")
        expect(saved.connection).toEqual(draft.connection)
        expect(invalidateQueries).toHaveBeenCalledWith({queryKey: ["mcp-endpoints"]})
    })

    it("updates the existing row instead of creating a second one under the same slug", async () => {
        get.mockResolvedValue({
            data: {
                endpoints: [
                    {id: "row-1", slug: "Acme-Notion", auth_mode: "none", data: {route: {}}},
                ],
            },
        })

        await registerMcpServerDraft(draft, "proj-42")

        expect(post).not.toHaveBeenCalled()
        expect(put).toHaveBeenCalledWith(
            "https://api.test/gateways/mcps/endpoints/row-1",
            expect.objectContaining({endpoint: expect.objectContaining({id: "row-1"})}),
            {params: {project_id: "proj-42"}},
        )
    })

    it("throws with the backend's reason so the drawer cannot save an unrunnable item", async () => {
        post.mockRejectedValue({response: {data: {detail: "'slug' must be URL-safe."}}})

        await expect(registerMcpServerDraft(draft, "proj-42")).rejects.toThrow(
            "'slug' must be URL-safe.",
        )
    })

    it("leaves a draft with nothing to register untouched", async () => {
        const untouched = {name: "exa", connection: {type: "http", url: ""}}
        expect(await registerMcpServerDraft(untouched, "proj-42")).toBe(untouched)
        expect(get).not.toHaveBeenCalled()
    })
})

describe("registrationErrorDetail", () => {
    it("prefers the backend's own message over the transport status", () => {
        expect(
            registrationErrorDetail({
                message: "Request failed with status code 422",
                response: {data: {detail: "'slug' must be URL-safe."}},
            }),
        ).toBe("'slug' must be URL-safe.")
    })

    it("falls back to the error message, then to a generic reason", () => {
        expect(registrationErrorDetail(new Error("Network Error"))).toBe("Network Error")
        expect(registrationErrorDetail({})).toBe("the request failed")
    })
})
