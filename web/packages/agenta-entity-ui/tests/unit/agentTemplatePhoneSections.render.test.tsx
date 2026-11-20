/**
 * On a phone the agent's sections are rows with their current value; a row opens its section as
 * its own screen, or the view the section already opens.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentTemplateSectionList} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentTemplateSectionList"
import {
    PhoneSectionsContext,
    type PhoneSectionsApi,
} from "../../src/DrillInView/SchemaControls/agentTemplate/phoneSections"

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
const sections = [
    {
        key: "model-harness",
        title: "Model",
        summary: "Claude Sonnet 5.5 · via Claude Code",
        onOpen: openModel,
        content: null,
    },
    {
        key: "skills",
        title: "Skills",
        summary: "ticket-triage, plain-writing",
        extra: createElement("button", {type: "button"}, "Add"),
        content: createElement("p", null, "skill rows"),
    },
]

const renderList = (phone: PhoneSectionsApi | null) =>
    act(() =>
        root.render(
            createElement(
                PhoneSectionsContext.Provider,
                {value: phone},
                createElement(AgentTemplateSectionList, {sections}),
            ),
        ),
    )

describe("AgentTemplateSectionList on a phone", () => {
    it("shows one row per section with its current value", () => {
        renderList({shownKey: null, show: vi.fn()})
        const rows = [...container.querySelectorAll("[data-testid=phone-section-list] button")]
        expect(rows.map((row) => row.textContent)).toEqual([
            "ModelClaude Sonnet 5.5 · via Claude Code",
            "Skillsticket-triage, plain-writing",
        ])
        expect(container.textContent).not.toContain("skill rows")
    })

    it("opens the section's view, or the section as its own screen", () => {
        const show = vi.fn()
        renderList({shownKey: null, show})
        const rows = container.querySelectorAll<HTMLButtonElement>(
            "[data-testid=phone-section-list] button",
        )
        act(() => rows[0].click())
        expect(openModel).toHaveBeenCalledOnce()
        expect(show).not.toHaveBeenCalled()
        act(() => rows[1].click())
        expect(show).toHaveBeenCalledWith("skills", "Skills")
    })

    it("shows only the open section's body and its add control", () => {
        renderList({shownKey: "skills", show: vi.fn()})
        expect(container.querySelector("[data-testid=phone-section-list]")).toBeNull()
        expect(container.textContent).toBe("Addskill rows")
    })

    it("keeps the accordion without the phone context", () => {
        renderList(null)
        expect(container.querySelector("[data-testid=phone-section-list]")).toBeNull()
        expect(container.querySelectorAll("[data-config-section]")).toHaveLength(2)
    })
})
