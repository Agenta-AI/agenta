/**
 * On the Configuration page (layout "page", canvas A04) each section is a title row with its
 * action and one card with the section's content, always open; a section that opens a view is one
 * row in its card.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentTemplateSectionList} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentTemplateSectionList"
import {SectionPageAction} from "../../src/DrillInView/SchemaControls/agentTemplate/SectionPageAction"
import {
    SectionListLayoutContext,
    type SectionListLayout,
} from "../../src/DrillInView/SchemaControls/agentTemplate/sectionListLayout"

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

const openModel = vi.fn()
const addSkill = vi.fn()
const sections = [
    {
        key: "model-harness",
        title: "Model",
        summary: "Claude Code · Claude Sonnet 5.5",
        onOpen: openModel,
        pageAction: createElement(SectionPageAction, {action: "change", onClick: openModel}),
        content: null,
    },
    {
        key: "skills",
        title: "Skills",
        summary: "2 skills",
        extra: createElement("button", {type: "button"}, "+"),
        pageAction: createElement(SectionPageAction, {action: "add", onClick: addSkill}),
        indicator: {tone: "draft" as const},
        defaultOpen: false,
        content: createElement("p", null, "skill rows"),
    },
]

const renderList = (layout: SectionListLayout | null) =>
    act(() =>
        root.render(
            createElement(
                SectionListLayoutContext.Provider,
                {value: layout},
                createElement(AgentTemplateSectionList, {sections}),
            ),
        ),
    )

describe("AgentTemplateSectionList on the Configuration page", () => {
    it("shows each section's title with its page action, and its content open", () => {
        renderList("page")
        const titles = [...container.querySelectorAll("section h3")].map((h) => h.textContent)
        expect(titles).toEqual(["Model", "Skills"])
        const skills = container.querySelector("[data-config-section=skills]")!
        expect(skills.getAttribute("data-config-section-title")).toBe("Skills")
        // Content shows although the section is not open by default; the header "+" does not.
        expect(skills.textContent).toContain("skill rows")
        expect(skills.textContent).not.toContain("+")
        const add = skills.querySelector("button") as HTMLButtonElement
        expect(add.textContent).toBe("Add")
        expect(add.disabled).toBe(false)
        act(() => add.click())
        expect(addSkill).toHaveBeenCalledTimes(1)
        expect(
            [...container.querySelectorAll("[data-config-section=model-harness] button")].map(
                (b) => b.textContent,
            ),
        ).toContain("Change")
    })

    it("keeps the section's change dot after its title", () => {
        renderList("page")
        const title = container.querySelector("[data-config-section=skills] h3")!
        expect(title.querySelector("span[aria-hidden]")).not.toBeNull()
        const model = container.querySelector("[data-config-section=model-harness] h3")!
        expect(model.querySelector("span[aria-hidden]")).toBeNull()
    })

    it("draws a section that opens a view as one row that opens it", () => {
        renderList("page")
        const model = container.querySelector("[data-config-section=model-harness]")!
        const row = [...model.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Claude Sonnet"),
        )!
        expect(row.textContent).toBe("ModelClaude Code · Claude Sonnet 5.5")
        act(() => row.click())
        expect(openModel).toHaveBeenCalledTimes(1)
    })

    it("keeps the accordion without the page layout", () => {
        renderList(null)
        expect(container.querySelector("section h3")).toBeNull()
        expect(container.textContent).not.toContain("Change")
    })
})
