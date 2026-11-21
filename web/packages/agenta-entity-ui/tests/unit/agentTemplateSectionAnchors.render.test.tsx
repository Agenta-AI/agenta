/**
 * Each section of the agent configuration carries an anchor, so a host (the Configuration page)
 * can list the sections and scroll to one.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest"

import {AgentTemplateSectionList} from "../../src/DrillInView/SchemaControls/agentTemplate/AgentTemplateSectionList"

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

describe("AgentTemplateSectionList anchors", () => {
    it("marks each section with its key and its title", () => {
        act(() =>
            root.render(
                createElement(AgentTemplateSectionList, {
                    sections: [
                        {key: "model-harness", title: "Model", content: "m"},
                        {key: "skills", title: createElement("span", null, "Skills"), content: "s"},
                    ],
                }),
            ),
        )
        const anchors = [...container.querySelectorAll<HTMLElement>("[data-config-section]")]
        expect(anchors.map((a) => a.dataset.configSection)).toEqual(["model-harness", "skills"])
        expect(anchors[0].dataset.configSectionTitle).toBe("Model")
        expect(anchors[1].dataset.configSectionTitle).toBeUndefined()
    })
})
