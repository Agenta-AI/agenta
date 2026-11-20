/**
 * Section marks: a container's mark (the builder page's "Changed by the builder") shows after the
 * title of each marked section; a click or Enter in a marked section reports it, and a section
 * that only opens by itself does not.
 */
import {act, createElement, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentTemplateSectionList} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentTemplateSectionList"
import {
    SectionMarksContext,
    useSectionMarks,
} from "../../src/DrillInView/SchemaControls/sectionMarks"

beforeAll(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const Marked = () => {
    const marked = useSectionMarks([
        {key: "instructions", title: "Instructions", content: "i", defaultOpen: true},
        {key: "skills", title: "Skills", content: "s"},
        {key: "model-harness", title: "Model", content: null, onOpen: () => {}},
    ])
    return createElement(
        "div",
        marked.handlers,
        createElement(AgentTemplateSectionList, {sections: marked.sections}),
    )
}

const render = (keys: string[], onOpened: (key: string) => void) =>
    act(() =>
        root.render(
            createElement(
                SectionMarksContext.Provider,
                {
                    value: {
                        keys: new Set(keys) as never,
                        label: "Changed by the builder",
                        onOpened,
                    },
                },
                createElement(Marked) as ReactNode,
            ),
        ),
    )

const section = (key: string) =>
    container.querySelector<HTMLElement>(`[data-config-section="${key}"]`)

describe("section marks", () => {
    it("shows the mark only on the marked sections", () => {
        render(["instructions"], () => {})
        expect(section("instructions")?.textContent).toContain("Changed by the builder")
        expect(section("skills")?.textContent).not.toContain("Changed by the builder")
    })

    it("reports a click in a marked section, not its own first reveal", async () => {
        const onOpened = vi.fn()
        render(["instructions", "model-harness"], onOpened)
        // The instructions section reveals itself after mount; that is not the person.
        await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
        expect(onOpened).not.toHaveBeenCalled()
        const header = section("model-harness")?.querySelector<HTMLElement>("[role=button]")
        act(() => {
            header?.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true}))
        })
        expect(onOpened).toHaveBeenCalledWith("model-harness")
        act(() => {
            section("skills")?.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true}))
        })
        expect(onOpened).toHaveBeenCalledTimes(1)
    })

    it("marks nothing without a provider", () => {
        act(() => root.render(createElement(Marked)))
        expect(container.textContent).not.toContain("Changed by the builder")
    })
})
