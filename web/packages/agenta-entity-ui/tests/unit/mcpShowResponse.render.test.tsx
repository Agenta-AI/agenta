/**
 * The raw answer behind a failed check: shown on request, and never more of it than a dialog
 * can hold.
 *
 * Nothing in the product reaches this yet. The probe keeps the status line and the sentence
 * and drops the payload (`api/oss/src/core/gateways/mcps/probe.py`), so the control renders
 * only where a body exists, which today is here. That is why it has a suite of its own: the
 * panel is the spec's, and without one it would ship unread until the probe grows a body.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    MAX_RESPONSE_CHARACTERS,
    ShowResponsePanel,
} from "../../src/mcpEndpoint/components/ShowResponsePanel"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (props: {statusLine?: string | null; body: string}) => {
    await act(async () => {
        root.render(createElement(ShowResponsePanel, props))
    })
}

const toggle = async () => {
    const button = document.querySelector("button")
    await act(async () => {
        button?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
}

const panel = () => document.querySelector('[data-testid="mcp-probe-response"]')

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
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

describe("the probe's raw answer", () => {
    it("stays closed until it is asked for", async () => {
        // It is debugging material, not the explanation. The sentence above it already said
        // what went wrong, and opening with a wall of HTML buries it.
        await render({statusLine: "HTTP/1.1 500 Internal Server Error", body: "boom"})

        expect(panel()).toBeNull()
        expect(document.body.textContent).toContain("Show response")
    })

    it("shows the status line and the body, and says how to put it away", async () => {
        await render({statusLine: "HTTP/1.1 500 Internal Server Error", body: "boom"})
        await toggle()

        expect(panel()?.textContent).toBe("HTTP/1.1 500 Internal Server Error\nboom")
        expect(document.body.textContent).toContain("Hide response")
    })

    it("closes again", async () => {
        await render({body: "boom"})
        await toggle()
        await toggle()

        expect(panel()).toBeNull()
    })

    it("cuts the body at three hundred characters", async () => {
        // Whatever answered is whatever is on the other end of an address someone typed.
        // A megabyte of it in a 480 pixel dialog helps nobody and scrolls the buttons away.
        await render({body: "x".repeat(MAX_RESPONSE_CHARACTERS + 50)})
        await toggle()

        expect(panel()?.textContent).toHaveLength(MAX_RESPONSE_CHARACTERS)
    })

    it("shows the body alone when there was no status line", async () => {
        await render({statusLine: null, body: "boom"})
        await toggle()

        expect(panel()?.textContent).toBe("boom")
    })
})
