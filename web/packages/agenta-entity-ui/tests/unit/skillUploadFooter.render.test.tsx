/**
 * In a view, the skill upload step runs from the view's own action row: the row reads Cancel and
 * Upload while the step is open, Upload waits for a file, and Cancel closes the step, not the view.
 */
import {act, createElement, useState} from "react"

import {
    defineView,
    DrawerViewChrome,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewDef,
} from "@agenta/ui/view-stack"
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
import {useSkillViewForm} from "../../src/DrillInView/SchemaControls/SkillUploadStep"

import {byText, findByText, waitFor} from "./domHelpers"

const SKILL = {name: "ticket-triage", description: "Triage tickets", body: "# Steps"}

const Body = () => {
    const [value, setValue] = useState<Record<string, unknown>>(SKILL)
    useViewTitle("ticket-triage")
    const {onUploadControl} = useSkillViewForm(
        {
            dirty: JSON.stringify(value) !== JSON.stringify(SKILL),
            valid: true,
            leaveDescription: "Unsaved",
            save: async () => true,
        },
        "Upload",
    )
    return createElement(SkillFormView, {
        value,
        onChange: setValue,
        baseline: SKILL,
        onUploadControl,
    })
}

const skillView: ViewDef<Record<string, never>> = defineView({
    id: "test.skill",
    apply: "on_save",
    Component: Body,
})

const Opener = () => {
    const stack = useViewStack()
    return createElement(
        "button",
        {onClick: () => void stack.open(skillView, {}, {kind: "project"})},
        "open",
    )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const click = async (el: HTMLElement) => {
    await act(async () => {
        el.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true, button: 0}))
        el.click()
    })
}

const footerButton = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => (b.textContent ?? "").trim() === name,
    )

beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root.render(
            createElement(
                ViewStackHost,
                {chrome: DrawerViewChrome, rootTitle: "Agent"},
                createElement(Opener),
            ),
        )
    })
    await click(byText("open") as HTMLElement)
    await findByText("Name")
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("skill upload in the view's action row", () => {
    it("reads Cancel and Upload, waits for a file, and Cancel closes only the step", async () => {
        expect(footerButton("Save")).toBeTruthy()
        const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        await click(trigger as HTMLButtonElement)
        await click((await findByText("Upload a folder or a .zip")) as HTMLElement)
        await findByText("Browse files")
        await waitFor(() => expect(footerButton("Upload")?.disabled).toBe(true))
        expect(footerButton("Save")).toBeUndefined()
        await click(footerButton("Cancel") as HTMLButtonElement)
        await waitFor(() => expect(byText("Browse files")).toBeFalsy())
        // The view is still open, back on SKILL.md, with its own Save.
        expect(byText("Name")).toBeTruthy()
        expect(footerButton("Save")).toBeTruthy()
    })
})
