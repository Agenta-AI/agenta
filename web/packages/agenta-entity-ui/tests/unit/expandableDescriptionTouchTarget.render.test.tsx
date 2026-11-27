// @vitest-environment jsdom
/**
 * The tool row's "Show more": an inline toggle with no chrome, on the control scale's 24px floor.
 *
 * A newline is what makes the toggle appear at all here, because jsdom has no layout and the
 * width measurement the row normally uses always reads zero.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {ExpandableDescription} from "../../src/DrillInView/SchemaControls/agentTemplate/ExpandableDescription"

const MULTILINE = "Merges a pull request.\n\nFails on a closed pull request."

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const renderDescription = async () => {
    await act(async () => {
        root.render(
            createElement(ExpandableDescription, {
                description: MULTILINE,
                label: "merge_pull_request",
            }),
        )
    })
}

const toggle = () => {
    const found = host.querySelector<HTMLButtonElement>("button")
    expect(found, "no Show more toggle").not.toBeNull()
    return found!
}

describe("the tool row's Show more toggle", () => {
    it("keeps its 24px floor", async () => {
        await renderDescription()

        expect(toggle().getAttribute("aria-label")).toBe("Show more about merge_pull_request")
        expect(toggle().className).toContain("min-h-control-xs")
    })

    it("becomes Show less once the description is open", async () => {
        await renderDescription()
        await act(async () => {
            toggle().click()
        })

        expect(toggle().getAttribute("aria-label")).toBe("Show less about merge_pull_request")
    })

    it("draws no chrome", async () => {
        await renderDescription()

        expect(toggle().className).toContain("bg-transparent")
    })
})

describe("the canvas tool line (F02 f6, M09)", () => {
    it("is a 12 px line that opens itself, with no caret", async () => {
        await act(async () => {
            root.render(
                createElement(ExpandableDescription, {
                    description: MULTILINE,
                    label: "merge_pull_request",
                    canvas: true,
                }),
            )
        })

        expect(toggle().querySelector("svg"), "no caret").toBeNull()
        expect(toggle().querySelector("span")?.className).toContain("text-meta")
        // A 20 px line, so the tool row is the canvas 63 px.
        expect(toggle().className).toContain("min-h-5")
    })

    it("shows the whole text with no toggle when full", async () => {
        await act(async () => {
            root.render(
                createElement(ExpandableDescription, {
                    description: MULTILINE,
                    label: "merge_pull_request",
                    canvas: true,
                    full: true,
                }),
            )
        })

        expect(host.querySelector("button")).toBeNull()
        const text = host.querySelector("span")
        expect(text?.className).toContain("whitespace-pre-line")
        expect(text?.className).not.toContain("truncate")
    })
})
