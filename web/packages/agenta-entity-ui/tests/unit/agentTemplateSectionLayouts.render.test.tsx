/**
 * The three layouts of the agent's sections. Null is the panel (canvas F01): inset 40 px rows, no
 * summary on an empty section. "pane" is the builder page pane (canvas B03): full-width 45 px
 * rows that keep "None". "page" is the Configuration page (canvas A04): one card per section.
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
    it("panel: 40 px inset rows with a 6 px gap, and no summary on an empty section", () => {
        renderList(null)
        const list = section("subagents").parentElement!
        expect(list.className).toContain("gap-1.5")
        expect(list.className).toContain("pt-3.5")
        expect(headerRow("subagents").className).toContain("h-[39px]")
        expect(headerRow("subagents").className).toContain("px-1")
        expect(section("subagents").textContent).not.toContain("None")
        expect(section("skills").textContent).toContain("2 skills")
        // The Advanced row keeps its sandbox and ends with the Phosphor caret, never a filled
        // triangle (MICRO-06).
        expect(section("advanced").textContent).toContain("Sandbox: Daytona")
        const caret = section("advanced").querySelector("[data-slot=collapse-caret]")
        expect(caret?.tagName.toLowerCase()).toBe("svg")
    })

    it("pane: full-width 45 px rows that keep None and tint a marked header", () => {
        renderList("pane")
        const list = section("subagents").parentElement!
        expect(list.className).toContain("-mx-4")
        expect(list.className).not.toContain("gap-1.5")
        expect(headerRow("subagents").className).toContain("h-[45px]")
        expect(headerRow("subagents").className).toContain("px-4")
        expect(section("subagents").textContent).toContain("None")
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
