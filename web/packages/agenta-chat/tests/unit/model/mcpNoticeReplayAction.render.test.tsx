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
        mcpEndpointsQueryAtom: atom({data: [CONNECTED_ROW]}),
        refreshMcpEndpointsAtom: atom(null, () => undefined),
    }
})

import {TOUCH_TARGET_MINIMUM_PX, touchTargetHeight} from "@agenta/ui/ui"

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

/** Control heights in px, restated here so this file does not lean on the kit for them. */
const SIZE_BY_CLASS_UNDER_TEST: Record<string, number> = {
    "h-control-xs": 24,
    "h-control-sm": 28,
}

/**
 * The reach, derived here rather than asked of the helper.
 *
 * D126 shipped because the helper and its reader shared one assumption, so every site test
 * asserted the class the helper had written rather than the box a finger gets. Reverting both
 * together still leaves the site packages green for that reason. This case closes that: it reads
 * the control's own size class, its own border class and its own `after` inset, and does the
 * arithmetic with numbers written here. It never calls the helper, so a coordinated change to
 * the helper and the reader cannot keep it passing.
 *
 * The size class is the border box and the inset is measured from inside the border, so the box
 * at the edge a reader can see is `size - 2 x border + 2 x inset`.
 */
const reachOf = (className: string) => {
    const classes = className.split(/\s+/).filter(Boolean)
    const size = SIZE_BY_CLASS_UNDER_TEST[classes.find((c) => c in SIZE_BY_CLASS_UNDER_TEST) ?? ""]
    const border = classes.includes("border-0") ? 0 : classes.includes("border") ? 1 : 0
    const inset = classes
        .map((c) => /^after:-inset-y-(?:\[(\d+)px\]|(\d+(?:\.\d+)?))$/.exec(c))
        .find(Boolean)
    const px = inset ? Number(inset[1] ?? Number(inset[2]) * 4) : 0
    return {size, border, inset: px, reach: size - 2 * border + 2 * px}
}

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

    it("gives Reconnect a 44px hit area at the banner's own 28px height", () => {
        // The banner rides in a transcript a phone scrolls, so its one action has to be
        // catchable with a thumb. 28px is the spec's height and the app's control scale; the
        // reach beyond it is an invisible box, which is why the banner still measures 108 x 28.
        const notice = readMcpServerNotice(REPLAYED_NOTICE)

        render(<McpServerNoticeCard notice={notice!} />)

        const reconnect = screen.getByRole("button", {name: "Reconnect Mock MCP"})
        expect(reconnect.className).toContain("h-control-sm")
        expect(touchTargetHeight(reconnect.className)).toBe(TOUCH_TARGET_MINIMUM_PX)
    })

    it("measures 44px of reach without asking the helper for it", () => {
        const notice = readMcpServerNotice(REPLAYED_NOTICE)

        render(<McpServerNoticeCard notice={notice!} />)

        const measured = reachOf(
            screen.getByRole("button", {name: "Reconnect Mock MCP"}).className,
        )
        expect(measured.size, "not the 28px control this case is about").toBe(28)
        expect(measured.border, "not the bordered Button this case is about").toBe(1)
        expect(measured.reach).toBe(44)
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
    })
})
