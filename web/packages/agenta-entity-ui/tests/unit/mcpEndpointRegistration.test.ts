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
    resolveMcpEndpointSecretId,
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
            // Both halves of `header_secret_refs`: the gateway needs the secret to resolve and
            // the header name to put it in, or the endpoint registers unrunnable.
            credentialHeader: "x-api-key",
            secretSlug: "exa",
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
        credentialHeader: "x-api-key",
        secretSlug: "exa",
    }

    // CHANGED (OR54): this case used to assert a create body with no `secret_id` and no
    // credential header, which is the defect — the service refuses every call on an
    // `api_key` endpoint that names no secret, so that payload registered an endpoint that
    // could never run. The binding is now part of the contract and the assertion says so.
    it("builds the create body the endpoints API expects, credential binding included", () => {
        expect(buildMcpEndpointCreate(registration, "secret-row-1")).toEqual({
            slug: "acme-notion",
            name: "Acme Notion",
            auth_mode: "api_key",
            secret_id: "secret-row-1",
            data: {
                route: {
                    base_url: "https://mcp.acme.test/mcp",
                    credential_header: "x-api-key",
                },
            },
        })
    })

    it("sends an explicit null when the drawer bound no secret", () => {
        const body = buildMcpEndpointCreate({
            ...registration,
            authMode: "none",
            credentialHeader: undefined,
            secretSlug: undefined,
        })
        expect(body.secret_id).toBeNull()
        expect(body.data.route.credential_header).toBeNull()
    })

    it("falls back to the slug when the server has no display name", () => {
        expect(buildMcpEndpointCreate({...registration, name: ""}).name).toBe("acme-notion")
    })

    it("rebinds an existing row to the secret the drawer now names", () => {
        const edit = buildMcpEndpointEdit(
            registration,
            {id: "row-1", auth_mode: "api_key", data: {route: {base_url: "https://old.test/mcp"}}},
            "secret-row-2",
        )
        expect(edit.secret_id).toBe("secret-row-2")
        expect(edit.data.route.credential_header).toBe("x-api-key")
    })

    it("updates an existing row in place, carrying the rest of its stored route over", () => {
        expect(
            buildMcpEndpointEdit(
                {...registration, credentialHeader: undefined, secretSlug: undefined},
                {
                    id: "row-1",
                    slug: "acme-notion",
                    auth_mode: "none",
                    secret_id: "secret-9",
                    data: {
                        route: {base_url: "https://old.test/mcp", headers: {"x-tenant": "acme"}},
                    },
                },
            ),
        ).toEqual({
            id: "row-1",
            name: "Acme Notion",
            auth_mode: "api_key",
            // A registration that names no secret says nothing about the binding, so the
            // row keeps the one it had rather than being silently unbound.
            secret_id: "secret-9",
            data: {
                route: {
                    base_url: "https://mcp.acme.test/mcp",
                    headers: {"x-tenant": "acme"},
                    credential_header: null,
                },
            },
        })
    })

    // OR51: the drawer collects a URL and a credential binding. Everything else on the row
    // belongs to whoever administers the endpoint, and a full PUT that says nothing about
    // those fields is read by the backend as "use the defaults", not as "leave them alone".
    it("leaves a disabled endpoint disabled, with its tool denylist and its ceiling", () => {
        const edit = buildMcpEndpointEdit(registration, {
            id: "row-3",
            slug: "acme-notion",
            auth_mode: "api_key",
            secret_id: "secret-9",
            data: {
                route: {base_url: "https://old.test/mcp"},
                tools: {denylist: ["delete_page"]},
                settings: {timeout_seconds: 12},
            },
            flags: {is_active: false, is_valid: true},
        })

        expect(edit.flags).toEqual({is_active: false, is_valid: true})
        expect(edit.data.tools).toEqual({denylist: ["delete_page"]})
        expect(edit.data.settings).toEqual({timeout_seconds: 12})
        // ...while the fields the drawer does own still follow the drawer.
        expect(edit.data.route.base_url).toBe("https://mcp.acme.test/mcp")
        expect(edit.data.route.credential_header).toBe("x-api-key")
    })

    it("sends no flags for a row that reported none, so the backend keeps its defaults", () => {
        const edit = buildMcpEndpointEdit(registration, {
            id: "row-4",
            auth_mode: "api_key",
            data: {route: {base_url: "https://old.test/mcp"}},
        })

        expect("flags" in edit).toBe(false)
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
                    // CHANGED (OR54): the create body now always states the binding. This
                    // draft binds nothing, so both fields are an explicit null.
                    secret_id: null,
                    data: {route: {base_url: "https://mcp.acme.test/mcp", credential_header: null}},
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

describe("resolveMcpEndpointSecretId", () => {
    const rows = [
        {id: "row-exa", slug: "exa"},
        {id: null, slug: "half-written"},
    ]

    it("translates the config's secret slug into the id the endpoint row binds", () => {
        expect(resolveMcpEndpointSecretId("exa", rows)).toBe("row-exa")
    })

    it("resolves nothing for a slug the project no longer has", () => {
        expect(resolveMcpEndpointSecretId("gone", rows)).toBeNull()
        expect(resolveMcpEndpointSecretId("half-written", rows)).toBeNull()
        expect(resolveMcpEndpointSecretId(undefined, rows)).toBeNull()
    })
})

describe("registering an API-key server (OR54)", () => {
    const draft = {
        name: "Exa",
        connection: {
            type: "http",
            url: "https://mcp.exa.test/mcp",
            credentials: {type: "header_secret_refs", headers: {"x-api-key": "exa"}},
        },
    }

    it("binds the drawer's project secret to the endpoint it registers", async () => {
        await registerMcpServerDraft(draft, "proj-42", [{id: "row-exa", slug: "exa"}])

        expect(post).toHaveBeenCalledWith(
            "https://api.test/gateways/mcps/endpoints/",
            {
                endpoint: {
                    slug: "Exa",
                    name: "Exa",
                    auth_mode: "api_key",
                    secret_id: "row-exa",
                    data: {
                        route: {
                            base_url: "https://mcp.exa.test/mcp",
                            credential_header: "x-api-key",
                        },
                    },
                },
            },
            {params: {project_id: "proj-42"}},
        )
    })

    it("rebinds a row registered before the secret was chosen", async () => {
        get.mockResolvedValue({
            data: {
                endpoints: [
                    {
                        id: "row-1",
                        slug: "Exa",
                        auth_mode: "none",
                        secret_id: null,
                        data: {route: {}},
                    },
                ],
            },
        })

        await registerMcpServerDraft(draft, "proj-42", [{id: "row-exa", slug: "exa"}])

        expect(put).toHaveBeenCalledWith(
            "https://api.test/gateways/mcps/endpoints/row-1",
            {
                endpoint: expect.objectContaining({
                    auth_mode: "api_key",
                    secret_id: "row-exa",
                }),
            },
            {params: {project_id: "proj-42"}},
        )
    })
})
