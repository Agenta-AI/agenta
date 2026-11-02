// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import type {QueryClient} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({
    pathname: "/w/[workspace_id]/p/[project_id]/prompts",
    query: {} as Record<string, string>,
    replace: vi.fn(),
}))
const folderClient = vi.hoisted(() => ({queryFolders: vi.fn()}))
vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getFoldersClient: () => folderClient,
}))

import {
    makePromptsStore,
    PromptsTestProviders,
    type TestFolder,
    type TestPrompt,
} from "./promptsTestStore"

import {usePromptsBrowser} from "@/features/prompts/usePromptsBrowser"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const FOLDERS: TestFolder[] = [
    {id: "f1", name: "Alpha"},
    {id: "f2", name: "Beta", parent_id: "f1"},
]
const PROMPTS: TestPrompt[] = [
    {id: "p1", name: "Welcome email", folder_id: "f2", created_at: "2026-01-02T00:00:00Z"},
    {id: "p2", name: "Summary", created_at: "2026-01-03T00:00:00Z"},
    {id: "p3", name: "Support bot", is_agent: true},
    {id: "p4", name: "Old draft", deleted_at: "2026-02-01T00:00:00Z"},
]

type Browser = ReturnType<typeof usePromptsBrowser>

describe("usePromptsBrowser", () => {
    let root: Root
    let latest: Browser

    const Probe = () => {
        latest = usePromptsBrowser()
        return null
    }

    const mount = (
        cache: Parameters<typeof makePromptsStore>[0] = {folders: FOLDERS, prompts: PROMPTS},
        prepare?: (client: QueryClient) => void,
    ) => {
        const {store, queryClient} = makePromptsStore(cache)
        prepare?.(queryClient)
        const tree: ReactNode = (
            <PromptsTestProviders store={store} queryClient={queryClient}>
                <Probe />
            </PromptsTestProviders>
        )
        act(() => root.render(tree))
    }

    beforeEach(() => {
        root = createRoot(document.createElement("div"))
        router.query = {}
        router.replace.mockReset()
    })
    afterEach(() => act(() => root.unmount()))

    it("Opening a folder writes folderId to the URL with a shallow replace", () => {
        mount()
        act(() => latest.openFolder("f1"))
        expect(router.replace).toHaveBeenCalledWith(
            {pathname: router.pathname, query: {folderId: "f1"}},
            undefined,
            {shallow: true},
        )
    })

    it("The root removes folderId from the URL", () => {
        router.query = {folderId: "f1", other: "x"}
        mount()
        act(() => latest.openFolder(null))
        expect(router.replace).toHaveBeenCalledWith(
            {pathname: router.pathname, query: {other: "x"}},
            undefined,
            {shallow: true},
        )
    })

    it("An unknown folderId falls back to the root after folders load", () => {
        router.query = {folderId: "gone"}
        mount()
        expect(router.replace).toHaveBeenCalledWith(
            {pathname: router.pathname, query: {}},
            undefined,
            {shallow: true},
        )
        expect(latest.folderId).toBeNull()
    })

    it("An unknown folderId is kept while folders still load", () => {
        router.query = {folderId: "f1"}
        mount({prompts: PROMPTS})
        expect(latest.isPending).toBe(true)
        expect(router.replace).not.toHaveBeenCalled()
        expect(latest.folderId).toBe("f1")
    })

    it("A folder missing from a cached list is kept while the list refreshes", () => {
        router.query = {folderId: "created-elsewhere"}
        folderClient.queryFolders.mockReturnValue(new Promise(() => undefined))
        // A copy older than the stale time: the list refetches on mount.
        mount({prompts: PROMPTS}, (client) =>
            client.setQueryData(["folders", "project-1"], FOLDERS, {
                updatedAt: Date.now() - 60_000,
            }),
        )
        expect(latest.isPending).toBe(false)
        expect(router.replace).not.toHaveBeenCalled()
        expect(latest.folderId).toBe("created-elsewhere")
    })

    it("A search term lists matches from every folder", () => {
        mount()
        act(() => latest.setSearch("WELCOME"))
        expect(latest.rows.map((row) => [row.key, row.depth])).toEqual([
            ["f1", 0],
            ["f2", 1],
            ["p1", 2],
        ])
    })

    it("Clearing the search returns to the open folder", () => {
        router.query = {folderId: "f1"}
        mount()
        act(() => latest.setSearch("summary"))
        expect(latest.rows.map((row) => row.key)).toEqual(["p2"])
        act(() => latest.setSearch(""))
        expect(latest.rows.map((row) => row.key)).toEqual(["f2"])
        expect(latest.chain.map((folder) => folder.id)).toEqual(["f1"])
    })

    it("Agents and archived prompts are not listed", () => {
        mount()
        expect(latest.rows.map((row) => row.key)).toEqual(["f1", "p2"])
    })

    it("A prompt whose folder was deleted shows at the root", () => {
        mount({
            folders: FOLDERS,
            prompts: [{id: "p9", name: "Stranded", folder_id: "deleted-folder"}],
        })
        expect(latest.rows.map((row) => row.key)).toEqual(["f1", "p9"])
    })

    it("A search with no match reports the search as the empty kind", () => {
        mount()
        act(() => latest.setSearch("zzz"))
        expect(latest.emptyKind).toBe("search")
    })
})
