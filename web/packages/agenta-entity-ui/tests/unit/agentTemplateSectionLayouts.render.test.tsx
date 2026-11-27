/**
 * The layouts of the agent's sections. Null is the panel (canvas F01): section cards with 40 px
 * rows and no summary on an empty section. "page" is the Configuration page (canvas A04).
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {
    AgentTemplateSectionList,
    type AgentTemplateSectionDescriptor,
} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentTemplateSectionList"
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

const sections: AgentTemplateSectionDescriptor[] = [
    {
        key: "subagents",
        title: "Subagents",
        summary: "None",
        empty: true,
        defaultOpen: false,
        content: createElement("span", null, "No subagents yet"),
    },
    {
        key: "skills",
        title: "Skills",
        summary: "2 skills",
        highlight: true,
        defaultOpen: false,
        content: createElement("span", null, "skill rows"),
    },
    {
        key: "advanced",
        title: "Advanced",
        summary: "Sandbox: Daytona",
        drawerAffordance: "triangle",
        onOpen: vi.fn(),
        content: null,
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

/** The clickable header row of one section. */
const headerRow = (key: string) =>
    container.querySelector(`[data-config-section=${key}] [role=button]`)!
        .parentElement as HTMLElement
const section = (key: string) => container.querySelector(`[data-config-section=${key}]`)!

describe("AgentTemplateSectionList layouts", () => {
    it("panel: 40 px card rows with no summary when empty, and a tinted marked header", () => {
        renderList(null)
        expect(headerRow("subagents").className).toContain("h-10")
        expect(section("subagents").textContent).not.toContain("None")
        expect(headerRow("skills").className).toContain("bg-info/10")
        expect(headerRow("subagents").className).not.toContain("bg-info/10")
    })

    it("page: one titled card per section, with its content always open", () => {
        renderList("page")
        const titles = [...container.querySelectorAll("section h3")].map((h) => h.textContent)
        expect(titles).toEqual(["Subagents", "Skills", "Advanced"])
        expect(section("subagents").textContent).toContain("No subagents yet")
        expect(container.querySelector("[role=button][aria-expanded]")).toBeNull()
    })
})
