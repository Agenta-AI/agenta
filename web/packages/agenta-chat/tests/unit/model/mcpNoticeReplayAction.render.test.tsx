// @vitest-environment jsdom
//
// A replayed reconnect notice has to stay ACTIONABLE, not merely present.
//
// The notice is projected into the durable transcript so a reload still explains why a server did
// not join. That is only worth having if the way back survives with it: the card resolves the
// connection from the notice's slug and offers Reconnect against it. D86 removed an endpoint id
// the notice carried and nothing read — the affordance never depended on it — and the case that
// stood over this asserted that removed field, so it pinned the wire rather than the thing a
// person can do. This drives the whole path instead: transcript record in, Reconnect button out.
//
// One case per state the spec draws for this banner, which are also its three stories:
// NeedsAuthorization, OtherFailure, UnresolvedConnection.
import {findCustomMcpEndpoint, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

/**
 * The project's settings rows. The card looks its server up by slug.
 *
 * Two of them, with the notice naming the second: a card that hands over whichever row it
 * finds first passes every single-row fixture ever written (D154).
 */
const {CONNECTED_ROW, OTHER_ROW} = vi.hoisted(() => ({
    OTHER_ROW: {
        id: "endpoint-0",
        slug: "other-slug",
        name: "Another server",
        namespace: "custom",
        auth_mode: "oauth",
        data: {route: {base_url: "https://mcp.other.test"}},
    },
    CONNECTED_ROW: {
        id: "endpoint-1",
        slug: "mock-mcp-slug",
        name: "Mock MCP",
        namespace: "custom",
        auth_mode: "oauth",
        data: {route: {base_url: "https://mcp.mock.test"}},
    },
}))

/** Every reconnect this card has handed the sheet, newest last. */
const {opened} = vi.hoisted(() => ({opened: [] as ({slug?: string; name?: string} | null)[]}))

// The sheet stands in for itself and records what it is given. A journey opened without a
// reconnect starts at address entry, which repairs nothing and invites a second connection;
// that is what one of the other mounts was doing (D132, and D131's remainder).
vi.mock("@agenta/entity-ui/mcpEndpoint", () => ({
    McpConnectJourney: ({
        open,
        reconnect,
    }: {
        open: boolean
        reconnect?: {slug?: string; name?: string} | null
    }) => {
        if (open) opened.push(reconnect ?? null)
        return open ? <div data-testid="mcp-connect-journey" /> : null
    },
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => {
    const {atom} = await import("jotai")
    const actual = await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()
    return {
        ...actual,
        mcpEndpointsQueryAtom: atom({data: [OTHER_ROW, CONNECTED_ROW]}),
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

/** A server that failed for a reason nothing has classified as an authorization problem. */
const OTHER_FAILURE = {
    serverName: "mock-mcp",
    reasonCode: "handshake_unreachable",
    message: "MCP server mock-mcp failed to connect: handshake_unreachable",
    detail: null,
}

afterEach(cleanup)

describe("a replayed MCP reconnect notice", () => {
    it("resolves the connection from its slug and offers Reconnect against it", () => {
        const notice = readMcpServerNotice(REPLAYED_NOTICE)
        expect(notice).not.toBeNull()

        render(<McpServerNoticeCard notice={notice!} />)

        // Named by the connection's own display name, which only a resolved row can supply.
        expect(screen.getByRole("button", {name: "Reconnect Mock MCP"})).toBeTruthy()
        // The drawer banner's sentence, so a lapsed login reads the same in both places.
        expect(screen.getByText("Mock MCP needs a new sign-in.")).toBeTruthy()
        expect(
            screen.getByText("Its tools fail until someone in the project reconnects."),
        ).toBeTruthy()
        // The marker is addressed to the runner and never reaches a screen.
        expect(document.body.textContent).not.toContain("agenta_code")
    })

    it("announces itself after the reader's own work, not over it", () => {
        const notice = readMcpServerNotice(REPLAYED_NOTICE)

        render(<McpServerNoticeCard notice={notice!} />)

        // A whole transcript of replayed notices would otherwise interrupt on every reload.
        expect(screen.getByRole("status")).toBeTruthy()
        expect(screen.queryByRole("alert")).toBeNull()
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

    it("keeps the run's own account of a failure it has not classified, with no remedy", () => {
        const notice = readMcpServerNotice(OTHER_FAILURE)

        render(<McpServerNoticeCard notice={notice!} />)

        expect(
            screen.getByText("MCP server mock-mcp failed to connect: handshake_unreachable"),
        ).toBeTruthy()
        // Signing in again is a guess here, and a Reconnect button would be that guess on screen.
        expect(screen.queryByRole("button", {name: /^Reconnect/})).toBeNull()
        expect(document.body.textContent).not.toContain("needs a new sign-in")
    })

    it("states the problem but offers no dead button for a connection this project cannot see", () => {
        // The row is gone, or belongs to another project. The sentence is still worth showing;
        // a Reconnect that cannot resolve a row is not.
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

        // Without a row there is no display name, so the notice names the server as the agent does.
        expect(screen.getByText("mock-mcp needs a new sign-in.")).toBeTruthy()
        expect(screen.queryByRole("button", {name: /^Reconnect/})).toBeNull()
    })
})

describe("what Reconnect opens", () => {
    afterEach(() => {
        opened.length = 0
    })

    it("hands the sheet the connection the notice resolved", () => {
        const notice = readMcpServerNotice(REPLAYED_NOTICE)
        render(<McpServerNoticeCard notice={notice!} />)

        fireEvent.click(screen.getByRole("button", {name: "Reconnect Mock MCP"}))

        expect(screen.getByTestId("mcp-connect-journey")).toBeTruthy()
        expect(opened.at(-1)).toMatchObject({slug: "mock-mcp-slug", name: "Mock MCP"})
        expect(opened.at(-1)).not.toMatchObject({slug: OTHER_ROW.slug})
    })
})
