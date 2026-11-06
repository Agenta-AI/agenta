import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("../../app-management/components/appWorkflowColumns", () => ({
    AppNameCell: () => null,
    AppTypeCell: () => null,
}))

import type {PromptsTableRow} from "../types"

import {createPromptsColumns, type PromptsColumnActions} from "./usePromptsColumns"

const app = {
    key: "app-1",
    type: "app",
    workflowId: "app-1",
    name: "qa-completion",
    folderId: "folder-1",
} as unknown as PromptsTableRow

const folder = {
    key: "folder-2",
    type: "folder",
    id: "folder-2",
    name: "qa-folder-2",
    parent_id: "folder-1",
    children: [],
} as unknown as PromptsTableRow

/**
 * The row menu (Radix) and the antd dialogs both trap the focus. When Move, Rename or Delete
 * opened its dialog while the menu was still open, each trap moved the focus back in turn, and the
 * /w Prompts page logged "Maximum call stack size exceeded". A dialog must open only after the
 * menu has closed.
 */
describe("Prompts row actions", () => {
    let root: Root
    let container: HTMLDivElement
    /** For each action call: whether a row menu was still open at that moment. */
    let calls: {action: string; menuOpen: boolean}[]

    const record = (action: string) => () => {
        calls.push({action, menuOpen: document.querySelector("[role=menu]") !== null})
    }

    const actions: PromptsColumnActions = {
        onFolderClick: record("open folder"),
        onRenameFolder: record("rename folder"),
        onDeleteFolder: record("delete folder"),
        onMoveItem: record("move"),
        onOpenAppOverview: record("open app"),
        onRenameApp: record("rename app"),
        onDeleteApp: record("archive app"),
    }

    const renderActions = (row: PromptsTableRow) => {
        const actionsColumn = createPromptsColumns(actions).at(-1) as {
            render: (value: unknown, record: PromptsTableRow, index: number) => ReactNode
        }
        act(() => root.render(<>{actionsColumn.render(undefined, row, 0)}</>))
    }

    const pick = async (label: string) => {
        const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Actions"]')
        await act(async () => {
            trigger?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        const item = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
            (menuItem) => menuItem.textContent?.trim() === label,
        )
        expect(item).toBeDefined()
        await act(async () => {
            item?.click()
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }

    beforeEach(() => {
        ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
        // The Radix menu measures itself; jsdom has no ResizeObserver.
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        )
        calls = []
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.unstubAllGlobals()
    })

    it("Move on an app opens the dialog after the menu has closed", async () => {
        renderActions(app)
        await pick("Move")
        expect(calls).toEqual([{action: "move", menuOpen: false}])
    })

    it.each([
        ["Move", "move"],
        ["Rename", "rename folder"],
        ["Delete", "delete folder"],
    ])("%s on a folder opens the dialog after the menu has closed", async (label, action) => {
        renderActions(folder)
        await pick(label)
        expect(calls).toEqual([{action, menuOpen: false}])
    })
})
