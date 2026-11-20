// "Copy" when the browser refuses the clipboard: no unhandled rejection, the selection copy runs,
// and "Copied" shows only when a copy worked.
import {act} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {SubscriptionTokenSteps} from "../../src/secretProvider/SubscriptionTokenSteps"
import type {SubscriptionTokenState} from "../../src/secretProvider/useSubscriptionToken"

const token = {
    value: "",
    checking: false,
    error: null,
    onChange: () => undefined,
    submit: async () => undefined,
} as unknown as SubscriptionTokenState

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
        },
    })
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
})

const copyButton = () =>
    [...host.querySelectorAll("button")].find((b) => /Cop/.test(b.textContent ?? "")) as HTMLElement

const pressCopy = async () => {
    await act(async () => {
        copyButton().click()
    })
}

describe("Copy with a refused clipboard", () => {
    it("falls back to a selection copy and shows Copied", async () => {
        const execCommand = vi.fn().mockReturnValue(true)
        document.execCommand = execCommand
        act(() => root.render(<SubscriptionTokenSteps token={token} />))
        await pressCopy()
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith("claude setup-token")
        expect(execCommand).toHaveBeenCalledWith("copy")
        expect(copyButton().textContent).toContain("Copied")
    })

    it("shows no Copied when no copy worked", async () => {
        document.execCommand = vi.fn().mockReturnValue(false)
        act(() => root.render(<SubscriptionTokenSteps token={token} />))
        await pressCopy()
        expect(copyButton().textContent).not.toContain("Copied")
    })
})
