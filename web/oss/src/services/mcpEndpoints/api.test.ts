import {beforeEach, describe, expect, it, vi} from "vitest"

import axios from "@/oss/lib/api/assets/axiosConfig"

import {beginMcpConnect, discoverMcpConnect, editMcpEndpoint} from "./api"

vi.mock("@/oss/lib/api/assets/axiosConfig", () => ({
    default: {get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn()},
}))

vi.mock("@/oss/lib/helpers/api", () => ({
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
