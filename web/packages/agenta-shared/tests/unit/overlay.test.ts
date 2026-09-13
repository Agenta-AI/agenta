// @vitest-environment jsdom
import {afterEach, describe, expect, it} from "vitest"

import {isOnScreen, isOverlayOpen} from "../../src/utils/overlay"

/** Mount the DOM a Radix layer produces: the role plus its open data-state. */
const layer = (role: string, state = "open") => {
    const el = document.createElement("div")
    el.setAttribute("role", role)
    el.setAttribute("data-state", state)
    document.body.append(el)
    return el
}

afterEach(() => {
    document.body.innerHTML = ""
})

describe("isOverlayOpen", () => {
    it("is false with nothing on top", () => {
        expect(isOverlayOpen()).toBe(false)
    })

    // Radix gives all of these the same dismissable layer, and that layer lets a keystroke keep
    // propagating to whatever sits behind it.
    it.each(["dialog", "alertdialog", "menu", "listbox"])("sees an open %s", (role) => {
        layer(role)
        expect(isOverlayOpen()).toBe(true)
    })

    it("ignores a layer that is closed", () => {
        for (const role of ["dialog", "menu", "listbox"]) layer(role, "closed")
        expect(isOverlayOpen()).toBe(false)
    })

    // A role with no data-state is not a Radix layer. The workflow revision drawer is antd's, and
    // it renders role="dialog" without one; the Alt shortcuts must keep working inside it.
    it("ignores a role that carries no data-state", () => {
        const el = document.createElement("div")
        el.setAttribute("role", "dialog")
        document.body.append(el)
        expect(isOverlayOpen()).toBe(false)
    })

    // antd sets no data-state and leaves its popups mounted after they close, so these are matched
    // by class and filtered by visibility. A tooltip is excluded on purpose.
    it.each([
        "ant-modal-wrap",
        "ant-drawer-open",
        "ant-dropdown",
        "ant-select-dropdown",
        "ant-popover",
    ])("sees an open .%s", (cls) => {
        const el = document.createElement("div")
        el.className = cls
        document.body.append(el)
        expect(isOverlayOpen()).toBe(true)
    })

    it("ignores an antd tooltip, which is passive", () => {
        const el = document.createElement("div")
        el.className = "ant-tooltip"
        document.body.append(el)
        expect(isOverlayOpen()).toBe(false)
    })

    it("sees an antd modal, and ignores one that is display:none", () => {
        const wrap = document.createElement("div")
        wrap.className = "ant-modal-wrap"
        document.body.append(wrap)
        expect(isOverlayOpen()).toBe(true)

        wrap.setAttribute("style", "display: none")
        expect(isOverlayOpen()).toBe(false)
    })
})

describe("isOnScreen", () => {
    it("is false for nothing", () => {
        expect(isOnScreen(null)).toBe(false)
    })

    it("is true for a rendered element and false behind display:none", () => {
        const el = document.createElement("div")
        document.body.append(el)
        expect(isOnScreen(el)).toBe(true)

        const hidden = document.createElement("div")
        hidden.style.display = "none"
        document.body.append(hidden)
        expect(isOnScreen(hidden)).toBe(false)
    })
})
