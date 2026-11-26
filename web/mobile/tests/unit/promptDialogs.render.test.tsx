// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {DeleteFolderDialog} from "@/features/prompts/dialogs/DeleteFolderDialog"
import {FolderNameDialog} from "@/features/prompts/dialogs/FolderNameDialog"
import {MoveToFolderDialog} from "@/features/prompts/dialogs/MoveToFolderDialog"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const FOLDERS = [
    {id: "f1", name: "Alpha", slug: "alpha"},
    {id: "f2", name: "Beta", slug: "beta", parent_id: "f1"},
    {id: "f3", name: "Gamma", slug: "gamma"},
]

const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    act(() => {
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}
const byText = (text: string) =>
    [...document.body.querySelectorAll("button")].find((b) => b.textContent === text)

describe("prompt dialogs", () => {
    let root: Root
    beforeEach(() => {
        root = createRoot(document.body.appendChild(document.createElement("div")))
    })
    afterEach(() => act(() => root.unmount()))

    it("Create is disabled until the name has text", () => {
        act(() =>
            root.render(
                <FolderNameDialog
                    open
                    mode="create"
                    pathFor={(n) => n}
                    onSubmit={vi.fn()}
                    onClose={vi.fn()}
                />,
            ),
        )
        expect(byText("Create")?.disabled).toBe(true)
        type(document.querySelector("input") as HTMLInputElement, "  ")
        expect(byText("Create")?.disabled).toBe(true)
        type(document.querySelector("input") as HTMLInputElement, "Docs")
        expect(byText("Create")?.disabled).toBe(false)
    })

    it("The dialog shows the slug and the folder path as the user types", () => {
        act(() =>
            root.render(
                <FolderNameDialog
                    open
                    mode="create"
                    pathFor={(n) => `alpha/${n.toLowerCase()}`}
                    onSubmit={vi.fn()}
                    onClose={vi.fn()}
                />,
            ),
        )
        type(document.querySelector("input") as HTMLInputElement, "My Docs")
        expect(document.body.textContent).toContain("Slug: my-docs")
        expect(document.body.textContent).toContain("Folder path: alpha/my docs")
    })

    it("Rename mode shows Rename folder and Save", () => {
        act(() =>
            root.render(
                <FolderNameDialog
                    open
                    mode="rename"
                    initialName="Alpha"
                    pathFor={(n) => n}
                    error="A folder with this path already exists in this project."
                    onSubmit={vi.fn()}
                    onClose={vi.fn()}
                />,
            ),
        )
        expect(document.body.textContent).toContain("Rename folder")
        expect((document.querySelector("input") as HTMLInputElement).value).toBe("Alpha")
        expect(byText("Save")).toBeTruthy()
        expect(document.body.textContent).toContain("already exists")
    })

    const moveDialog = (onConfirm = vi.fn(), initialSelectedId: string | null = null) =>
        act(() =>
            root.render(
                <MoveToFolderDialog
                    open
                    itemName="Welcome email"
                    folders={FOLDERS}
                    initialSelectedId={initialSelectedId}
                    isDisabled={(id) => id === "f1" || id === initialSelectedId}
                    onConfirm={onConfirm}
                    onClose={vi.fn()}
                />,
            ),
        )

    it("The move button names the destination", () => {
        const onConfirm = vi.fn()
        moveDialog(onConfirm)
        expect(document.body.textContent).toContain("Moving Welcome email")
        // The prompt sits at the top level, so All prompts is where it is now.
        expect(byText("Move to All prompts")?.disabled).toBe(true)
        const gamma = [...document.querySelectorAll("[role=treeitem]")].find((n) =>
            n.textContent?.includes("Gamma"),
        ) as HTMLElement
        act(() => gamma.click())
        const confirm = byText("Move to Gamma")
        expect(confirm?.disabled).toBe(false)
        act(() => confirm?.click())
        expect(onConfirm).toHaveBeenCalledWith("f3")
    })

    it("The current parent and the folder itself cannot be picked", () => {
        moveDialog(vi.fn(), "f1")
        const alpha = [...document.querySelectorAll("[role=treeitem]")].find((n) =>
            n.textContent?.includes("Alpha"),
        ) as HTMLButtonElement
        expect(alpha.disabled).toBe(true)
        expect(document.querySelectorAll("[role=treeitem]")).toHaveLength(4)
        expect(byText("Move to Alpha")?.disabled).toBe(true)
    })

    it("All prompts comes first and moves the item to the top level", () => {
        const onConfirm = vi.fn()
        moveDialog(onConfirm, "f1")
        const [root] = document.querySelectorAll<HTMLButtonElement>("[role=treeitem]")
        expect(root.textContent).toBe("All prompts")
        act(() => root.click())
        act(() => byText("Move to All prompts")?.click())
        expect(onConfirm).toHaveBeenCalledWith(null)
    })

    it("Delete names the folder or says this folder", () => {
        act(() =>
            root.render(
                <DeleteFolderDialog
                    open
                    folderName="Alpha"
                    onConfirm={vi.fn()}
                    onClose={vi.fn()}
                />,
            ),
        )
        expect(document.body.textContent).toContain("You are about to delete:")
        expect(document.body.textContent).toContain("Alpha")
        act(() => root.render(<DeleteFolderDialog open onConfirm={vi.fn()} onClose={vi.fn()} />))
        expect(document.body.textContent).toContain("this folder")
    })
})
