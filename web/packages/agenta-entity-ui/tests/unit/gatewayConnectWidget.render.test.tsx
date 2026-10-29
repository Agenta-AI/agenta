/**
 * CR12, second half: every app that renders a transcript must get the gateway-target widget.
 *
 * `request_connection` arrives with either an integration key or a gateway target, and only the
 * default widget set decides which surface answers it. That set is what /w and /m both resolve
 * through, so the split has to live here. While it lived in the desktop app's own skin, a target
 * on mobile fell through to the integration widget, which has no provider drawer, no MCP journey
 * and no catalog to open, and the person was left with a row that could not be answered.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtom: () => [false, vi.fn()],
    useAtomValue: () => ({data: []}),
    useSetAtom: () => vi.fn(),
}))

const {clientToolWidgets} = await import("../../src/clientTools")

const metaFor = (input: unknown) =>
    ({
        input,
        toolCallId: "call-1",
        toolName: "request_connection",
        state: "input-available",
        settled: false,
        output: undefined,
        part: {},
    }) as never

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const renderWidget = async (input: unknown) => {
    const Widget = clientToolWidgets.byToolName.request_connection
    await act(async () => {
        root.render(createElement(Widget, {meta: metaFor(input), settle: vi.fn()}))
    })
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe("the default request_connection widget", () => {
    it("answers a gateway target with the gateway surface", async () => {
        await renderWidget({target: {plane: "mcp", name: "acme-notion"}})

        expect(host.textContent).toContain("acme-notion")
        expect(host.textContent).toContain("MCP server")
        expect(host.querySelectorAll("button")).toHaveLength(2)
    })

    it("names the plane a model provider on the llm side", async () => {
        await renderWidget({target: {plane: "llm", name: "openai"}})

        expect(host.textContent).toContain("openai")
        expect(host.textContent).toContain("model provider")
    })

    it("leaves an integration request to the integration widget", async () => {
        await renderWidget({integration: "slack"})

        expect(host.textContent).not.toContain("MCP server")
        expect(host.textContent).not.toContain("model provider")
    })

    it("is the same widget on both dispatch axes, so a missing render hint changes nothing", () => {
        expect(clientToolWidgets.byRenderKind.connect).toBe(
            clientToolWidgets.byToolName.request_connection,
        )
    })
})
