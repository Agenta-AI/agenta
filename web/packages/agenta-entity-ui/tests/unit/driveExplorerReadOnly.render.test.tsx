/**
 * @vitest-environment jsdom
 *
 * Files read only (a phone, M03): the explorer of a writable drive opens and downloads, and its
 * menus leave every write out (not disabled). The same drive, editable, offers its writes, so the
 * test sees the difference.
 */
import {act} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const files = [
    {path: "notes.md", size: 12, modified_at: "2026-11-20T10:00:00Z", is_folder: false},
    {path: "reports", size: 0, modified_at: "2026-11-20T10:00:00Z", is_folder: true},
]

// The per-directory fetch is the network part; the tree is built from these rows for real.
vi.mock("../../src/drive/useLazyDriveTree", () => ({
    useLazyDriveTree: () => ({
        files,
        fetchingDirs: new Set<string>(),
        loadedDirs: new Set([""]),
        rootLoading: false,
        searchLoading: false,
        subscribers: null,
    }),
}))

const {DriveExplorer} = await import("../../src/drive/DriveExplorer")
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true
// jsdom has no layout: the grid and the tree measure nothing.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver

const mount = {id: "mount-1", slug: "cwd", name: "cwd"}
const drive = {
    mount,
    files,
    fileCount: 1,
    totalSize: 12,
    recents: [],
    lastTouchedAt: null,
    summary: "",
    isLoading: false,
    errored: false,
    resolveMount: (path: string) => ({mount, path}),
}

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

const renderExplorer = async (readOnly: boolean, initialPath = "") => {
    // One client for the provider and the Jotai queries, as an app host wires them.
    const client = new QueryClient()
    const store = createStore()
    store.set(queryClientAtom, client)
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <Provider store={store}>
                    <DriveExplorer
                        drive={drive as never}
                        initialPath={initialPath}
                        onClose={() => undefined}
                        readOnly={readOnly}
                        touch={readOnly}
                    />
                </Provider>
            </QueryClientProvider>,
        ),
    )
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

/** Opens row 2's "More actions" menu and reads its entries, and whether each one is on. */
const folderMenu = async () => {
    const trigger = [...host.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-label") === "More actions",
    )!
    await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    })
    return Object.fromEntries(
        [...document.querySelectorAll('[role="menuitem"]')].map((item) => [
            item.textContent?.trim(),
            !item.hasAttribute("data-disabled"),
        ]),
    )
}

const WRITES = ["New folder", "New file", "Upload files…"]

describe("DriveExplorer read only", () => {
    it("leaves the folder's writes out on a writable drive, and keeps the download", async () => {
        await renderExplorer(true)
        const menu = await folderMenu()
        for (const entry of WRITES) expect(menu).not.toHaveProperty(entry)
        expect(menu["Download all.zip"]).toBe(true)
    })

    it("offers the folder's writes when it is editable", async () => {
        await renderExplorer(false)
        const menu = await folderMenu()
        for (const entry of WRITES) expect(menu[entry]).toBe(true)
    })

    it("leaves Rename and Delete out of an open file's menu, and keeps Download", async () => {
        await renderExplorer(true, "notes.md")
        const menu = await folderMenu()
        expect(menu).not.toHaveProperty("Rename")
        expect(menu).not.toHaveProperty("Delete")
        expect(menu.Download).toBe(true)
    })

    it("offers Rename and Delete for an open file when it is editable", async () => {
        await renderExplorer(false, "notes.md")
        const menu = await folderMenu()
        expect(menu.Rename).toBe(true)
        expect(menu.Delete).toBe(true)
    })
})
