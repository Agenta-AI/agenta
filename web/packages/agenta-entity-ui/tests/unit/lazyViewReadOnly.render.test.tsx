/**
 * A view the host shows read only (`readOnlyOnPhone` on a phone) reads the agent through a
 * read-only editor, so its body shows no edit control.
 */
import {act, createElement, useContext} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it} from "vitest"

import {AgentEditorContext} from "../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter"
import {lazyView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/lazyView"

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

const Body = () => {
    const editor = useContext(AgentEditorContext)
    return createElement("span", null, editor?.readOnly ? "read only" : "editable")
}
const View = lazyView(async () => ({default: Body}))

const renderView = async (readOnly: boolean | undefined) => {
    await act(async () =>
        root.render(
            createElement(
                AgentEditorContext.Provider,
                {value: {revisionId: "rev-4", readOnly: false}},
                createElement(View, {
                    params: {},
                    target: {kind: "agent_draft", revisionId: "rev-4"},
                    readOnly,
                } as never),
            ),
        ),
    )
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

describe("lazyView read only", () => {
    it("gives the body a read-only editor when the host shows it read only", async () => {
        await renderView(true)
        expect(container.textContent).toBe("read only")
    })

    it("keeps the editor when the host does not", async () => {
        await renderView(undefined)
        expect(container.textContent).toBe("editable")
    })
})
