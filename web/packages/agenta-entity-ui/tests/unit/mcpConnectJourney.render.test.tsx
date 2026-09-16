/**
 * D48: the product has to take the step, not the test.
 *
 * The D22 and D23 suites drive the hook and call `loadTools` and unmount by hand, so deleting
 * the effect that starts tool discovery, or the wrapper that unmounts a closed journey, leaves
 * them green. These two render the real dialog and touch nothing but the controls a person
 * touches, so each fails if its driver is removed.
 *
 * The dialog renders through a portal, so every query here goes to the document rather than to
 * the host node.
 */
import {act, createElement, useState} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {probeMcpUrl, createMcpEndpoint, listMcpTools, discoverMcpConnect} = vi.hoisted(() => ({
    probeMcpUrl: vi.fn(),
    createMcpEndpoint: vi.fn(),
    listMcpTools: vi.fn(),
    discoverMcpConnect: vi.fn(),
}))

vi.mock("../../../agenta-entities/src/mcpEndpoint/api/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../agenta-entities/src/mcpEndpoint/api/api")>()),
    probeMcpUrl,
    createMcpEndpoint,
    listMcpTools,
    discoverMcpConnect,
}))

vi.mock("@agenta/shared/api", () => ({getAgentaApiUrl: () => "https://api.example.test"}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => "project-1",
    useSetAtom: () => async () => undefined,
}))

import McpConnectJourney from "../../src/mcpEndpoint/McpConnectJourney"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

/**
 * An input by its accessible name, whichever way it carries one: some fields put an
 * `aria-label` on the input, others only render a `<label for>` above it.
 */
const field = (name: string): HTMLInputElement | null => {
    const labelled = document.querySelector(`input[aria-label="${name}"]`)
    if (labelled) return labelled as HTMLInputElement

    const label = [...document.querySelectorAll("label")].find((candidate) =>
        candidate.textContent?.startsWith(name),
    )
    const id = label?.getAttribute("for")
    return id ? (document.getElementById(id) as HTMLInputElement | null) : null
}

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)

/** Flush until a condition holds, so a count is taken after the work has settled. */
const waitFor = async (condition: () => boolean, label: string) => {
    for (let i = 0; i < 50; i++) {
        if (condition()) return
        await act(async () => {
            await Promise.resolve()
        })
    }
    throw new Error(`timed out waiting for ${label}`)
}

/** Let the dialog mount its portal and any awaited work behind a click resolve. */
const settle = async () => {
    for (let i = 0; i < 4; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

/** Render the host and wait until the portalled dialog is actually in the document. */
const openJourney = async () => {
    await act(async () => {
        root.render(createElement(Host))
    })
    await settle()
}

/** React tracks its own value on a controlled input, so a bare assignment is ignored. */
const typeInto = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input) as object,
        "value",
    )?.set
    await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const press = async (element: Element | undefined) => {
    await act(async () => {
        element?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
    await settle()
}

/**
 * A host that keeps the journey rendered and toggles `open`, which is what the settings
 * section does and what made the state survive into the next attempt.
 */
let setOpen: (open: boolean) => void
const Host = () => {
    const [open, setOpenState] = useState(true)
    setOpen = setOpenState
    return createElement(McpConnectJourney, {open, onClose: () => setOpenState(false)})
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    probeMcpUrl.mockResolvedValue({
        count: 1,
        probe: {reachable: true, server_name: "Acme", auth: {mode: "none", scopes_offered: []}},
    })
    createMcpEndpoint.mockResolvedValue({
        count: 1,
        endpoint: {id: "mcp-1", slug: "acme-7mx", name: "Acme", auth_mode: "none"},
    })
    listMcpTools.mockResolvedValue([{name: "echo", description: "Echo it back"}])
    discoverMcpConnect.mockResolvedValue({count: 1, scopes_offered: ["tools:list"]})
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("the rendered journey", () => {
    it("lists the tools after connecting, with nobody asking it to", async () => {
        await openJourney()

        await typeInto(field("MCP server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        await typeInto(field("Connection name")!, "Acme")
        await press(button("Continue"))

        // Nothing in this test called the loader. The dialog's own effect has to.
        expect(listMcpTools).toHaveBeenCalledWith("acme-7mx", "project-1")
        expect(document.body.textContent).toContain("1 tool available")
        expect(button("Done")).toBeDefined()
    })

    it("asks for a URL again after closing and reopening", async () => {
        await openJourney()

        await typeInto(field("MCP server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        expect(field("Connection name")).not.toBeNull()

        // Closed and reopened through the host, the way the settings section does it.
        await act(async () => setOpen(false))
        await settle()
        await act(async () => setOpen(true))
        await settle()

        expect(field("MCP server URL")).not.toBeNull()
        expect(field("MCP server URL")!.value).toBe("")
        expect(field("Connection name")).toBeNull()
    })
})

describe("connecting a server that uses OAuth", () => {
    it("reads the offered scopes once", async () => {
        // Deferred on purpose. With an instantly-resolving stub the direct call finished
        // before React re-rendered, so the effect never saw `discovering_scopes` and the
        // duplicate could not be observed — the shape of the real bug needs a discovery that
        // is still in flight while the component renders.
        let release: (value: unknown) => void = () => undefined
        discoverMcpConnect.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )
        probeMcpUrl.mockResolvedValue({
            count: 1,
            probe: {
                reachable: true,
                server_name: "Acme",
                auth: {mode: "oauth", scopes_offered: ["tools:list"]},
            },
        })

        await openJourney()
        await typeInto(field("MCP server URL")!, "https://mcp.acme.test/")
        await press(button("Continue"))
        await typeInto(field("Connection name")!, "Acme")
        await press(button("Continue"))

        // Counted only once discovery has finished, so a second in-flight call cannot hide
        // behind the flush window. Two callers used to race here: `submitName` awaited
        // discovery itself while the transition it had already dispatched fired the effect
        // that does the same. Each call is an outbound round trip and a full-row write on the
        // server (D31).
        // Counted while the first call is still in flight, which is when a second caller
        // would fire. Two callers used to race here: `submitName` awaited discovery itself
        // while the transition it had already dispatched fired the effect that does the same.
        // Each call is an outbound round trip and a full-row write on the server (D31).
        await settle()
        expect(discoverMcpConnect).toHaveBeenCalledTimes(1)

        release({count: 1, scopes_offered: ["tools:list"]})
        await waitFor(
            () =>
                document.body.textContent?.includes("Choose which permissions to grant.") ?? false,
            "the scope checklist",
        )
        expect(discoverMcpConnect).toHaveBeenCalledTimes(1)
    })
})
