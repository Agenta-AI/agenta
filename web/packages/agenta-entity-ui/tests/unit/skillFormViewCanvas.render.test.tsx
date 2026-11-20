/**
 * The skill view as the canvas draws it (F07): the open file is marked in the menu, the first
 * search result shows as picked, an added file's empty path is not an error yet, the Advanced
 * help names the skill's command, and in a view the upload step leaves Cancel and Upload to the
 * view's action row.
 */
import {act, createElement, useState} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("../../src/DrillInView/SchemaControls/MarkdownEditor", () => ({
    MarkdownEditor: () => createElement("div", {"data-testid": "markdown"}),
}))
vi.mock("../../src/DrillInView/SchemaControls/CodeEditor", () => ({
    CodeEditor: () => createElement("div", {"data-testid": "code"}),
    codeLanguageFromPath: () => "code",
}))

import {SkillFormView} from "../../src/DrillInView/SchemaControls/SkillFormView"
import type {SkillUploadControl} from "../../src/DrillInView/SchemaControls/SkillUploadStep"

import {byText, findByText, waitFor} from "./domHelpers"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let control: SkillUploadControl | null = null

const SKILL = {
    name: "ticket-triage",
    description: "Triage tickets",
    body: "# Steps",
    files: [
        {path: "examples.md", content: "e"},
        {path: "references/refund-policy.md", content: "r"},
    ],
}

const Harness = ({inView}: {inView: boolean}) => {
    const [value, setValue] = useState<Record<string, unknown>>(SKILL)
    return createElement(SkillFormView, {
        value,
        onChange: setValue,
        baseline: SKILL,
        // The skill view paints missing fields once the draft is edited and invalid.
        showMissing: true,
        onUploadControl: inView
            ? (next: SkillUploadControl | null) => {
                  control = next
              }
            : undefined,
    })
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

const mount = async (inView = false) => {
    await act(async () => {
        root.render(createElement(Harness, {inView}))
    })
}

beforeEach(() => {
    control = null
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("SkillFormView, canvas F07", () => {
    it("marks the open file in the menu", async () => {
        await mount()
        await openMenu()
        const open = document.querySelector('[aria-current="true"]')
        expect(open?.textContent).toContain("SKILL.md")
        expect(open?.querySelectorAll("svg").length).toBe(2)
    })

    it("shows the first result as picked and keeps 'Add a file' for no match", async () => {
        await mount()
        const search = await openMenu()
        await type(search, "re")
        await findByText("refund-policy.md")
        const first = byText("refund-policy.md")?.closest("button")
        expect(first?.className).toContain("bg-colorFillSecondary")
        expect(byText("Add a file")).toBeFalsy()
        await type(search, "zzz")
        await findByText("No file matches")
        expect(byText("Add a file")).toBeTruthy()
    })

    it("an added file's empty path is not an error until the person types in it", async () => {
        await mount()
        await openMenu()
        await click((await findByText("Add a file")) as HTMLElement)
        const path = (await findByText(
            "",
            'input[placeholder="scripts/foo.py"]',
        )) as HTMLInputElement
        expect(byText("Required.")).toBeFalsy()
        await type(path, "a.md")
        await type(path, "")
        await findByText("Required.")
    })

    it("the Advanced help names the skill's own command", async () => {
        await mount()
        await click(byText("Advanced") as HTMLElement)
        await findByText(
            "The agent won't pick this skill on its own. You run it yourself with /skill:ticket-triage.",
        )
    })

    it("in a view, the upload step reports to the action row and draws no buttons", async () => {
        await mount(true)
        await openMenu()
        await click((await findByText("Upload a folder or a .zip")) as HTMLElement)
        await findByText("Browse files")
        expect(byText("Upload")).toBeFalsy()
        expect(byText("Cancel")).toBeFalsy()
        await waitFor(() => expect(control?.ready).toBe(false))
        await act(async () => control?.cancel())
        await waitFor(() => expect(control).toBeNull())
        expect(byText("Browse files")).toBeFalsy()
    })
})
