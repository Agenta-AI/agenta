/**
 * @vitest-environment jsdom
 *
 * The rename field owns Enter and Escape: a page-level Escape (Stop on a running agent) must not
 * see them.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import InlineRenameInput from "../../src/InlineRenameInput"
import type {InlineRename} from "../../src/useInlineRename"

let container: HTMLDivElement
let root: Root
let rename: InlineRename
const pageKeys = vi.fn()

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    rename = {
        renaming: true,
        draft: "Old name",
        setDraft: vi.fn(),
        start: vi.fn(),
        commit: vi.fn(async () => undefined),
        cancel: vi.fn(),
    }
    // The page's own Escape listener, as LiveConversation has one.
    document.addEventListener("keydown", pageKeys)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(InlineRenameInput, {rename, ariaLabel: "Agent name"})))
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.removeEventListener("keydown", pageKeys)
    vi.clearAllMocks()
})

const press = (key: string) => {
    const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true})
    act(() => {
        container.querySelector("input")?.dispatchEvent(event)
    })
    return event
}

describe("InlineRenameInput", () => {
    it("Escape cancels the rename and never reaches the page", () => {
        const event = press("Escape")
        expect(rename.cancel).toHaveBeenCalledOnce()
        expect(event.defaultPrevented).toBe(true)
        expect(pageKeys).not.toHaveBeenCalled()
    })

    it("Enter saves the rename and never reaches the page", () => {
        const event = press("Enter")
        expect(rename.commit).toHaveBeenCalledOnce()
        expect(event.defaultPrevented).toBe(true)
        expect(pageKeys).not.toHaveBeenCalled()
    })

    it("other keys pass through", () => {
        const event = press("a")
        expect(event.defaultPrevented).toBe(false)
        expect(pageKeys).toHaveBeenCalledOnce()
    })
})
