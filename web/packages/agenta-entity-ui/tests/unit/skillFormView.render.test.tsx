/**
 * The file menu of the skill view, rendered: Enter in the search opens the first result, a search
 * with no match says so and keeps "Add a file", and "Add a file" opens an empty file whose path
 * refuses one that another file has.
 */
import {act, createElement, useState} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The editors load Lexical and CodeMirror; the menu and the path field are this file's subject.
vi.mock("../../src/DrillInView/SchemaControls/MarkdownEditor", () => ({
    MarkdownEditor: () => createElement("div", {"data-testid": "markdown"}),
}))
vi.mock("../../src/DrillInView/SchemaControls/CodeEditor", () => ({
    CodeEditor: () => createElement("div", {"data-testid": "code"}),
    codeLanguageFromPath: () => "code",
}))

import {SkillFormView} from "../../src/DrillInView/SchemaControls/SkillFormView"

import {byText, findByText, waitFor} from "./domHelpers"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let latest: Record<string, unknown> = {}

const SKILL = {
    name: "ticket-triage",
    description: "Triage tickets",
    body: "# Steps",
    files: [
        {path: "examples.md", content: "e"},
        {path: "references/refund-policy.md", content: "r"},
        {path: "templates/reply-billing.md", content: "b"},
        {path: "scripts/classify_ticket.py", content: "p"},
    ],
}

const Harness = () => {
    const [value, setValue] = useState<Record<string, unknown>>(SKILL)
    latest = value
    return createElement(SkillFormView, {value, onChange: setValue, baseline: SKILL})
}

const click = async (el: HTMLElement) => {
    await act(async () => {
        el.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, button: 0}))
        el.click()
    })
}

const type = async (input: HTMLInputElement, text: string) => {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(input, text)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const openMenu = async () => {
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
    if (!trigger) throw new Error("no file button")
    await click(trigger)
    return (await findByText("", 'input[placeholder="Find a file"]')) as HTMLInputElement
}

beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root.render(createElement(Harness))
    })
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("SkillFormView file menu", () => {
    it("Enter in the search opens the first result", async () => {
        const search = await openMenu()
        await type(search, "re")
        await findByText("2 of 5 files · Enter opens the first one")
        await act(async () => {
            search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        await waitFor(() => {
            const path = document.querySelector<HTMLInputElement>(
                'input[placeholder="scripts/foo.py"]',
            )
            expect(path?.value).toBe("references/refund-policy.md")
        })
    })

    it("says 'No file matches' and keeps 'Add a file'", async () => {
        const search = await openMenu()
        await type(search, "zzz")
        await findByText("No file matches")
        expect(byText("Add a file")).toBeTruthy()
    })

    it("adds a file in a new folder and refuses a path another file has", async () => {
        await openMenu()
        await click((await findByText("Add a file")) as HTMLElement)
        const path = (await findByText(
            "",
            'input[placeholder="scripts/foo.py"]',
        )) as HTMLInputElement
        await type(path, "lib/new.py")
        expect((latest.files as {path: string}[]).map((f) => f.path)).toContain("lib/new.py")

        await type(path, "examples.md")
        await findByText("Another file of this skill has this path.")
        // The first file keeps its content: nothing is replaced.
        expect((latest.files as {path: string; content: string}[])[0]).toEqual({
            path: "examples.md",
            content: "e",
        })
    })
})
