/**
 * @vitest-environment jsdom
 *
 * The skill form in a read-only view (a phone): Name and Description are text rows and the
 * switches read On or Off, as the other read-only views show their values. The editable form
 * keeps its fields.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("../../src/DrillInView/SchemaControls/MarkdownEditor", () => ({
    MarkdownEditor: ({value, showToolbar}: {value: string; showToolbar?: boolean}) => (
        <div data-testid="body" data-toolbar={String(Boolean(showToolbar))}>
            {value}
        </div>
    ),
}))
vi.mock("../../src/DrillInView/SchemaControls/CodeEditor", () => ({
    CodeEditor: () => null,
    codeLanguageFromPath: () => "text",
}))

const {SkillFormView} = await import("../../src/DrillInView/SchemaControls/SkillFormView")

const skill = {
    name: "plain-writing",
    description: "Writes replies in plain words",
    body: "# Write plainly",
    allow_executable_files: true,
}

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = (ui: React.ReactElement) => act(() => root.render(ui))
const byText = (text: string) =>
    [...host.querySelectorAll("span")].filter((element) => element.textContent === text)
const body = () => host.querySelector<HTMLElement>('[data-testid="body"]')!

describe("SkillFormView read only", () => {
    it("shows Name, Description and the switches as text, with no field", () => {
        render(<SkillFormView value={skill} onChange={() => undefined} disabled valuesAsText />)
        expect(host.querySelector("input, textarea")).toBeNull()
        expect(byText("plain-writing")).toHaveLength(1)
        expect(byText("Writes replies in plain words")).toHaveLength(1)
        expect(body().dataset.toolbar).toBe("false")
        // Advanced opens by itself because a switch is on.
        expect(host.querySelector('[role="switch"]')).toBeNull()
        expect(byText("On")).toHaveLength(1)
        expect(byText("Off")).toHaveLength(1)
    })

    it("keeps the fields and the switches when it is editable", () => {
        render(<SkillFormView value={skill} onChange={() => undefined} />)
        const name = host.querySelector<HTMLInputElement>('input[placeholder="my-skill"]')!
        expect(name.value).toBe("plain-writing")
        expect(host.querySelector("textarea")?.value).toBe("Writes replies in plain words")
        expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2)
        expect(body().dataset.toolbar).toBe("true")
    })
})
