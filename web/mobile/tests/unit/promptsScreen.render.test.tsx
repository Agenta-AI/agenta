// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({
    pathname: "/w/[workspace_id]/p/[project_id]/prompts",
    query: {} as Record<string, string>,
    replace: vi.fn(),
}))
const permissions = vi.hoisted(() => ({edit_folders: true, edit_workflows: true}))
const folderClient = vi.hoisted(() => ({queryFolders: vi.fn()}))

vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getFoldersClient: () => folderClient,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: "edit_folders" | "edit_workflows") =>
        permissions[action],
}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/ScreenScaffold", () => ({
    ScreenScaffold: ({header, children}: {header: ReactNode; children: ReactNode}) => (
        <div>
            {header}
            {children}
        </div>
    ),
}))

import {
    makePromptsStore,
    PromptsTestProviders,
    type TestFolder,
    type TestPrompt,
} from "./promptsTestStore"

import {PromptsScreen} from "@/features/prompts/PromptsScreen"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const FOLDERS: TestFolder[] = [
    {id: "f1", name: "Alpha", slug: "alpha"},
    {id: "f2", name: "Beta", slug: "beta", parent_id: "f1"},
]
const PROMPTS: TestPrompt[] = [
    {id: "p1", name: "Welcome email", is_chat: true},
    {id: "p2", name: "Summary", folder_id: "f1"},
]

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
const bodyRows = () => [...document.querySelectorAll("div.group.grid")] as HTMLElement[]
const rowNames = () => bodyRows().map((row) => row.textContent ?? "")
const buttonByText = (text: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))
const openMenu = (trigger: Element) =>
    act(() => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    })

describe("PromptsScreen", () => {
    let root: Root
    let render: () => void

    const mount = (
        cache: {folders?: TestFolder[]; prompts?: TestPrompt[]} = {
            folders: FOLDERS,
            prompts: PROMPTS,
        },
    ) => {
        const {store, queryClient} = makePromptsStore(cache)
        render = () =>
            act(() =>
                root.render(
                    <PromptsTestProviders store={store} queryClient={queryClient}>
                        <PromptsScreen workspaceId="ws" projectId="project-1" />
                    </PromptsTestProviders>,
                ),
            )
        render()
    }

    beforeEach(() => {
        window.matchMedia = ((query: string) => ({
            matches: true,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
        })) as unknown as typeof window.matchMedia
        root = createRoot(document.body.appendChild(document.createElement("div")))
        router.query = {}
        router.replace.mockReset()
        router.replace.mockImplementation((target: {query: Record<string, string>}) => {
            router.query = target.query
            render()
        })
        permissions.edit_folders = true
        permissions.edit_workflows = true
        folderClient.queryFolders.mockReset()
    })
    afterEach(() => {
        act(() => root.unmount())
        document.body.innerHTML = ""
    })

    it("The root lists folders before prompts", () => {
        mount()
        const rows = rowNames()
        expect(rows).toHaveLength(2)
        expect(rows[0]).toContain("Alpha")
        expect(rows[0]).toContain("Folder")
        expect(rows[1]).toContain("Welcome email")
    })

    it("Clicking a folder row opens it and the breadcrumb shows it", () => {
        mount()
        act(() => bodyRows()[0].click())
        expect(router.replace).toHaveBeenCalledTimes(1)
        expect(document.querySelector("nav")?.textContent).toContain("Alpha")
        expect(rowNames().map((row) => row.includes("Beta") || row.includes("Summary"))).toEqual([
            true,
            true,
        ])
    })

    it("The house button returns to the root", () => {
        router.query = {folderId: "f1"}
        mount()
        expect(document.querySelector("nav")?.textContent).toContain("Alpha")
        act(() => (document.querySelector("[aria-label='All prompts']") as HTMLElement).click())
        expect(document.querySelector("nav")?.textContent).not.toContain("Alpha")
    })

    it("The caret menu offers Rename, Move, New folder and Delete", () => {
        router.query = {folderId: "f1"}
        mount()
        openMenu(document.querySelector("nav [aria-label='Alpha Actions']") as Element)
        const items = [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)
        expect(items).toEqual(["Rename", "Move", "New folder", "Delete"])
    })

    it("A search with no match shows No prompts match", () => {
        mount()
        const input = document.querySelector("input") as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        act(() => {
            setter?.call(input, "zzz")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(document.body.textContent).toContain("No prompts match")
    })

    it("A failed load shows a retry", async () => {
        folderClient.queryFolders.mockRejectedValue(new Error("offline"))
        mount({prompts: PROMPTS})
        await settle()
        expect(document.body.textContent).toContain("Could not load prompts")
        expect(buttonByText("Retry") ?? buttonByText("Try again")).toBeTruthy()
    })

    it("A reader without write rights sees no prompt menu and no Create new", () => {
        permissions.edit_folders = false
        permissions.edit_workflows = false
        mount()
        expect(buttonByText("Create new")).toBeUndefined()
        const menus = document.querySelectorAll("div.group.grid [aria-label='Actions']")
        // Only the folder row keeps a menu, with Open as its one verb.
        expect(menus).toHaveLength(1)
        openMenu(menus[0])
        expect([...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)).toEqual(
            ["Open"],
        )
    })

    it("A prompt row has no Open item while the overview is not built", () => {
        mount()
        const promptRow = bodyRows()[1]
        // Not a button and not focusable: it is not a link.
        expect(promptRow.getAttribute("role")).toBeNull()
        expect(promptRow.getAttribute("tabindex")).toBeNull()
        expect(promptRow.className).not.toContain("cursor-pointer")
        openMenu(promptRow.querySelector("[aria-label='Actions']") as Element)
        expect([...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)).toEqual(
            ["Rename", "Move", "Archive"],
        )
    })
})
