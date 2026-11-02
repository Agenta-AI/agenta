/**
 * Copy, cut and paste in the event instruction's pill editor keep pills as pills.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {PillEditor} from "../../src/gatewayTrigger/drawers/subscription/PillEditor"

const TEMPLATE = "Review {{event.attributes.title}} now"

beforeAll(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
})

let container: HTMLDivElement
let root: Root
let onChange: ReturnType<typeof vi.fn>

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    onChange = vi.fn()
    act(() => {
        root.render(createElement(PillEditor, {value: TEMPLATE, onChange, labelFor: () => "Title"}))
    })
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const box = () => container.querySelector<HTMLElement>("[role=textbox]")!

function select(collapseToEnd: boolean) {
    const range = document.createRange()
    range.selectNodeContents(box())
    if (collapseToEnd) range.collapse(false)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
}

function clipboard(type: "copy" | "cut" | "paste", data: Record<string, string> = {}) {
    const event = new Event(type, {bubbles: true, cancelable: true})
    Object.defineProperty(event, "clipboardData", {
        value: {
            getData: (key: string) => data[key] ?? "",
            setData: (key: string, value: string) => {
                data[key] = value
            },
        },
    })
    act(() => {
        box().dispatchEvent(event)
    })
    return data
}

describe("PillEditor clipboard", () => {
    it("copies readable text with the pill's label, and the template next to it", () => {
        select(false)
        const data = clipboard("copy")
        expect(data["text/plain"]).toBe("Review Title now")
        expect(data["application/x-agenta-template"]).toBe(TEMPLATE)
    })

    it("pastes a copied template back as pills", () => {
        select(true)
        clipboard("paste", {"application/x-agenta-template": " {{event.attributes.url}}"})
        expect(onChange).toHaveBeenLastCalledWith(`${TEMPLATE} {{event.attributes.url}}`)
        expect(box().querySelectorAll("[data-token]")).toHaveLength(2)
    })

    it("pastes text from elsewhere as text", () => {
        select(true)
        clipboard("paste", {"text/plain": " thanks"})
        expect(onChange).toHaveBeenLastCalledWith(`${TEMPLATE} thanks`)
    })

    it("cuts the selection and keeps its template on the clipboard", () => {
        select(false)
        const data = clipboard("cut")
        expect(data["application/x-agenta-template"]).toBe(TEMPLATE)
        expect(onChange).toHaveBeenLastCalledWith("")
    })
})
