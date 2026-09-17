/**
 * The skills picker's "Added" label, and the token it is painted with.
 *
 * It read `text-[var(--ag-colorSuccessText)]`, and `--ag-colorSuccessText` is declared in no
 * stylesheet in either app, so the label inherited the row's colour: green in the MCP drawer
 * beside it, and whatever the row happened to be here. This is the `--ag-colorLink` bug WP6
 * found on the tool row, in a second place. The class form is the fix, because a class that
 * resolves to nothing emits no rule at all, which is the thing nobody can see.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {SkillPickerDrawer} from "../../src/SkillPickerDrawer"
import type {SkillListItem} from "../../src/types"

const ADDED: SkillListItem = {
    id: "skill-1",
    slug: "release-notes",
    name: "release-notes",
    origin: "custom",
    added: true,
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async () => {
    await act(async () => {
        root.render(
            createElement(SkillPickerDrawer, {
                open: true,
                onClose: vi.fn(),
                options: [ADDED],
                onAdd: vi.fn(),
                onRemove: vi.fn(),
                createActions: {onWrite: vi.fn(), onUpload: vi.fn(), onImport: vi.fn()},
            }),
        )
    })
}

/** The drawer is portalled, so the query is against the document. */
const addedLabel = () =>
    [...document.querySelectorAll("span")].find(
        // The innermost one: the row wraps it in a span that reads the same.
        (node) => (node.textContent ?? "").trim() === "Added" && !node.querySelector("span"),
    )

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

describe("the skills picker's Added label", () => {
    it("is painted with a token both apps declare", async () => {
        await render()

        const label = addedLabel()
        expect(label, "no Added label").toBeDefined()
        expect(label!.className).toContain("text-colorSuccess")
        expect(label!.className).not.toContain("--ag-colorSuccessText")
    })
})
