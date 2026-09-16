// @vitest-environment jsdom
//
// A replayed reconnect notice has to stay ACTIONABLE, not merely present.
//
// The notice is projected into the durable transcript so a reload still explains why a server did
// not join. That is only worth having if the way back survives with it: the card resolves the
// connection from the notice's slug and offers Connect against it. D86 removed an endpoint id the
// notice carried and nothing read — the affordance never depended on it — and the case that stood
// over this asserted that removed field, so it pinned the wire rather than the thing a person can
// do. This drives the whole path instead: transcript record in, Connect button out.
import {findCustomMcpEndpoint, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

/** The project's settings row for that server. The card looks it up by slug. */
const {CONNECTED_ROW} = vi.hoisted(() => ({
    CONNECTED_ROW: {
        id: "endpoint-1",
        slug: "mock-mcp-slug",
        name: "Mock MCP",
        namespace: "custom",
        auth_mode: "oauth",
        data: {route: {base_url: "https://mcp.mock.test"}},
    },
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()
    return {
        ...actual,
        mcpEndpointsQueryAtom: atom({data: [CONNECTED_ROW]}),
        refreshMcpEndpointsAtom: atom(null, () => undefined),
    }
})

import {McpServerNoticeCard} from "../../../src/components/McpServerNoticeCard"
import {readMcpServerNotice} from "../../../src/model/mcpServerNotice"

/** The runner event as the durable transcript replays it, marker and all. */
const REPLAYED_NOTICE = {
    serverName: "mock-mcp",
    reasonCode: "handshake_http_error",
    status: 409,
    message: "MCP server mock-mcp failed to connect: 409",
    detail: {
        code: "auth_required",
        message: "Authorization required for custom/mock-mcp-slug ⟦agenta_code:auth_required⟧",
        retryable: false,
        details: {
            cause: "auth_required",
            requirement: {
                target: "custom/mock-mcp-slug",
                state: "needs_auth",
                connect: {endpoint: "/gateways/mcps/endpoints/endpoint-1/connect", body: {}},
            },
        },
    },
}

afterEach(cleanup)

describe("a replayed MCP reconnect notice", () => {
    it("resolves the connection from its slug and offers Connect against it", () => {
        const notice = readMcpServerNotice(REPLAYED_NOTICE)
        expect(notice).not.toBeNull()

        render(<McpServerNoticeCard notice={notice!} />)

        // Named by the connection's own display name, which only a resolved row can supply.
        expect(screen.getByRole("button", {name: "Connect Mock MCP"})).toBeTruthy()
        expect(screen.getByText(/needs authorization before its tools can run/)).toBeTruthy()
        // The marker is addressed to the runner and never reaches a screen.
        expect(document.body.textContent).not.toContain("agenta_code")
    })

    it("resolves it through the same lookup the card uses", () => {
        const notice = readMcpServerNotice(REPLAYED_NOTICE)

        expect(
            findCustomMcpEndpoint(
                [CONNECTED_ROW as unknown as MCPEndpoint],
                notice?.slug ?? undefined,
            )?.id,
        ).toBe("endpoint-1")
    })

    it("states the problem but offers no dead button for a connection this project cannot see", () => {
        // The row is gone, or belongs to another project. The sentence is still worth showing;
        // a Connect that cannot resolve a row is not.
        const notice = readMcpServerNotice({
            ...REPLAYED_NOTICE,
            detail: {
                ...REPLAYED_NOTICE.detail,
                details: {
                    ...REPLAYED_NOTICE.detail.details,
                    requirement: {
                        ...REPLAYED_NOTICE.detail.details.requirement,
                        target: "custom/some-other-slug",
                    },
                },
            },
        })

        render(<McpServerNoticeCard notice={notice!} />)

        expect(screen.getByText(/needs authorization before its tools can run/)).toBeTruthy()
        expect(screen.queryByRole("button", {name: /^Connect/})).toBeNull()
    })
})
