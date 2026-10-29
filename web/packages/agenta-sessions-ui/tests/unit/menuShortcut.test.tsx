/**
 * @vitest-environment jsdom
 *
 * Which session menu rows earn a keycap. `Alt+R`, `Alt+A` and `Alt+W` act on the ACTIVE session,
 * never on the row whose menu is open, so only the active row's menu may name them (#6842).
 */
import {act, createElement, type ReactNode} from "react"
import {createRoot, type Root} from "react-dom/client"

import {afterEach, describe, expect, it} from "vitest"

import {withSessionShortcutKeys} from "../../src/menuShortcut"

const entries = [
    {key: "rename", label: "Rename"},
    {key: "pin", label: "Pin"},
    {key: "archive", label: "Archive"},
    {key: "delete", label: "Delete"},
]

let host: HTMLDivElement | null = null
let root: Root | null = null

const textOf = (label: ReactNode): string => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(createElement("span", null, label)))
    return host.textContent ?? ""
}

afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = null
    host = null
})

describe("withSessionShortcutKeys", () => {
    it("names the keys on the active session's menu", () => {
        const out = withSessionShortcutKeys(entries, {isActive: true})
        const rename = textOf(out[0].label)
        expect(rename).toContain("Rename")
        expect(rename.length).toBeGreaterThan("Rename".length)
    })

    // The trap this exists to close: the keycap said the archive key on a row it does not act on.
    it("leaves every other row's label alone", () => {
        const out = withSessionShortcutKeys(entries, {isActive: false})
        expect(out.map((entry) => entry.label)).toEqual(["Rename", "Pin", "Archive", "Delete"])
    })

    it("names only the verbs a shortcut actually reaches", () => {
        const out = withSessionShortcutKeys(entries, {isActive: true})
        // Pin and Delete have no binding, so they stay plain strings on the active row too.
        expect(out[1].label).toBe("Pin")
        expect(out[3].label).toBe("Delete")
    })

    it("passes a divider through untouched", () => {
        const dividers = [{type: "divider" as const}]
        expect(withSessionShortcutKeys(dividers, {isActive: true})).toEqual(dividers)
    })
})
