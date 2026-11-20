/**
 * Section marks: a container's mark (the builder page's "Changed by the builder") shows after the
 * title of each marked section, and opening a marked section reports it once.
 */
import {act, createElement, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentTemplateSectionList} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentTemplateSectionList"
import {
    SectionMarksContext,
    useMarkedSections,
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

const Marked = ({onOpenDrawer}: {onOpenDrawer: () => void}) =>
    createElement(AgentTemplateSectionList, {
        sections: useMarkedSections([
            {key: "instructions", title: "Instructions", content: "i"},
            {key: "skills", title: "Skills", content: "s"},
            {key: "model-harness", title: "Model", content: null, onOpen: onOpenDrawer},
        ]),
    })

const render = (keys: string[], onOpened: (key: string) => void, onOpenDrawer = () => {}) =>
    act(() =>
        root.render(
            createElement(
                SectionMarksContext.Provider,
                {value: {keys: new Set(keys), label: "Changed by the builder", onOpened}},
                createElement(Marked, {onOpenDrawer}) as ReactNode,
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

    it("reports a marked drawer section when it opens", () => {
        const onOpened = vi.fn()
        const onOpenDrawer = vi.fn()
        render(["model-harness"], onOpened, onOpenDrawer)
        const header = section("model-harness")?.querySelector<HTMLElement>("[role=button]")
        act(() => header?.click())
        expect(onOpened).toHaveBeenCalledWith("model-harness")
        expect(onOpenDrawer).toHaveBeenCalled()
    })

    it("marks nothing without a provider", () => {
        act(() => root.render(createElement(Marked, {onOpenDrawer: () => {}})))
        expect(container.textContent).not.toContain("Changed by the builder")
    })
})
