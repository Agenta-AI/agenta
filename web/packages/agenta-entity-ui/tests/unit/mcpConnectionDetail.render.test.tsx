/**
 * The connection detail drawer, which two fixes landed in and nothing guarded.
 *
 * M4: a tool list is fetched per connection and arrives whenever it arrives, so opening a
 * second connection while the first is still in flight used to render the first one's tools
 * under the second one's name. The guard is an identity check on the answer, and the only way
 * to observe it is to keep the first fetch in flight while the drawer moves on — a stub that
 * resolves immediately decides that race before the product does.
 *
 * And the tool list's failure is a sentence a person can read with a Retry beside it, not a
 * prompt to reauthorize: the server is connected, and what failed is the listing.
 *
 * The drawer renders through a portal, so every query here goes to the document rather than to
 * the host node.
 */
import {act, createElement} from "react"

import type {MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {listMcpTools} = vi.hoisted(() => ({listMcpTools: vi.fn()}))

// The component imports the api module directly, so the package barrel is the wrong seam.
vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    listMcpTools,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
    useSetAtom: () => async () => undefined,
}))

import McpConnectionDetail from "../../src/mcpEndpoint/McpConnectionDetail"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const connected = (overrides: Partial<MCPEndpoint> = {}): MCPEndpoint =>
    ({
        id: "mcp-1",
        slug: "acme",
        name: "Acme",
        auth_mode: "oauth",
        namespace: "custom",
        secret_id: "grant-1",
        data: {route: {base_url: "https://mcp.acme.test"}},
        ...overrides,
    }) as MCPEndpoint

const settle = async () => {
    for (let i = 0; i < 6; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

const open = async (endpoint: MCPEndpoint | null) => {
    await act(async () => {
        root.render(
            createElement(McpConnectionDetail, {
                endpoint,
                onClose: () => undefined,
                onReconnect: () => undefined,
                onDisconnect: () => undefined,
            }),
        )
    })
    await settle()
}

/** The drawer's text, portal included. */
const text = (): string => (document.body.textContent ?? "").replace(/\s+/g, " ").trim()

const toolNames = (): string[] =>
    [...document.querySelectorAll('[data-testid="mcp-tool"]')].map(
        (node) => node.querySelector("span")?.textContent ?? "",
    )

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    listMcpTools.mockReset()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
})

describe("McpConnectionDetail on a phone", () => {
    it("is a bottom sheet below the breakpoint and a right-edge drawer above it", async () => {
        // The same prop the add-server drawer and the permission drawer beside it pass. With the
        // default `right` a 520px panel slid in from the edge of a phone. The geometry itself is
        // measured in a browser; what this pins is that the drawer asks for the responsive side.
        listMcpTools.mockResolvedValue([{name: "search"}])
        await open(connected())

        const panel = document.querySelector('[role="dialog"]')
        expect(panel, "no drawer panel").not.toBeNull()
        expect(panel!.className).toContain("bottom-0")
        expect(panel!.className).toContain("lg:right-0")
    })
})

describe("McpConnectionDetail: whose tools are on screen", () => {
    it("lists the tools of the connection it was opened for", async () => {
        listMcpTools.mockResolvedValue([{name: "search", description: "Search the corpus"}])
        await open(connected())

        expect(toolNames()).toEqual(["search"])
        expect(listMcpTools).toHaveBeenCalledWith("acme", "project-1")
    })

    it("never shows one connection's tools under another connection's name", async () => {
        // Held in flight on purpose: with an instant answer the first fetch settles before the
        // drawer can move on, and the race the guard exists for never happens.
        let answerFirst!: (tools: unknown[]) => void
        listMcpTools.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    answerFirst = resolve as (tools: unknown[]) => void
                }),
        )
        listMcpTools.mockResolvedValueOnce([{name: "deploy"}])

        await open(connected())
        await open(connected({id: "mcp-2", slug: "beta", name: "Beta"}))
        await act(async () => {
            answerFirst([{name: "search"}])
        })
        await settle()

        expect(text()).toContain("Beta")
        expect(toolNames()).toEqual(["deploy"])
    })

    it("asks again from scratch when the drawer moves to another connection", async () => {
        listMcpTools.mockResolvedValue([{name: "search"}])
        await open(connected())
        await open(connected({id: "mcp-2", slug: "beta", name: "Beta"}))

        expect(listMcpTools.mock.calls.map((call) => call[0])).toEqual(["acme", "beta"])
    })

    it("says the server has to be connected before it can report tools", async () => {
        // The same drawer straight after a disconnect: the status is read from the row it is
        // showing now, so the previous connection's tools are neither listed nor re-fetched.
        await open(connected({secret_id: null, flags: {is_valid: false}}))

        expect(text()).toContain("Connect this server to see the tools it exposes.")
        expect(toolNames()).toEqual([])
        expect(listMcpTools).not.toHaveBeenCalled()
    })
})

describe("McpConnectionDetail: finding one tool among many", () => {
    /** Enough tools that the filter appears at all, with one worth hunting for. */
    const many = Array.from({length: 40}, (_, index) => ({
        name: `tool_${index}`,
        description: index === 7 ? "File a new issue in a team" : "Does a thing",
    }))

    /** Type into the filter box the way a person does, through the real input event. */
    const typeFilter = async (value: string) => {
        const box = document.querySelector<HTMLInputElement>('[aria-label="Filter tools"]')!
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value",
            )!.set!
            setter.call(box, value)
            box.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await settle()
    }

    it("offers a filter once there are enough tools to hunt through", async () => {
        listMcpTools.mockResolvedValue(many)
        await open(connected())

        expect(document.querySelector('[aria-label="Filter tools"]')).not.toBeNull()
    })

    it("does not put a filter above a handful", async () => {
        listMcpTools.mockResolvedValue([{name: "search"}, {name: "deploy"}])
        await open(connected())

        expect(document.querySelector('[aria-label="Filter tools"]')).toBeNull()
    })

    it("narrows the rows to what was typed, by name or by what the tool does", async () => {
        listMcpTools.mockResolvedValue(many)
        await open(connected())

        await typeFilter("issue")

        // tool_7 matches on its description, which this drawer renders, so the result reads.
        expect(toolNames()).toEqual(["tool_7"])
    })

    it("says the query matched nothing rather than looking like a server with no tools", async () => {
        listMcpTools.mockResolvedValue(many)
        await open(connected())

        await typeFilter("nothing-matches-this")

        expect(text()).toContain("No tool here matches that")
        expect(text()).not.toContain("This server exposes no tools yet")
    })

    it("restores the whole list when the query is cleared", async () => {
        listMcpTools.mockResolvedValue(many)
        await open(connected())

        await typeFilter("issue")
        await typeFilter("")

        expect(toolNames()).toHaveLength(40)
    })
})

describe("McpConnectionDetail: a tool list that could not be read", () => {
    it("states the failure and offers to try the listing again", async () => {
        listMcpTools.mockRejectedValueOnce(new Error("The gateway timed out."))
        await open(connected())

        expect(text()).toContain("The gateway timed out.")
        // Connected, with a listing problem: nothing here suggests reauthorizing.
        expect(text()).not.toContain("Needs authorization")
        expect(button("Retry tools")).toBeTruthy()
    })

    it("falls back to a readable sentence when the failure carried no message", async () => {
        listMcpTools.mockRejectedValueOnce(new Error(""))
        await open(connected())

        expect(text()).toContain("The tool list could not be read.")
    })

    it("lists the tools once a retry succeeds", async () => {
        listMcpTools.mockRejectedValueOnce(new Error("The gateway timed out."))
        listMcpTools.mockResolvedValueOnce([{name: "search"}])
        await open(connected())

        await act(async () => {
            button("Retry tools")?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        await settle()

        expect(toolNames()).toEqual(["search"])
        expect(text()).not.toContain("The gateway timed out.")
    })

    it("does not put a stale failure under the connection that replaced it", async () => {
        let failFirst!: (error: Error) => void
        listMcpTools.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    failFirst = reject
                }),
        )
        listMcpTools.mockResolvedValueOnce([{name: "deploy"}])

        await open(connected())
        await open(connected({id: "mcp-2", slug: "beta", name: "Beta"}))
        await act(async () => {
            failFirst(new Error("The gateway timed out."))
        })
        await settle()

        expect(text()).not.toContain("The gateway timed out.")
        expect(toolNames()).toEqual(["deploy"])
    })
})
