import {describe, expect, it} from "vitest"

import {
    browseRows,
    buildFolderTree,
    filterTreeBySearch,
    folderChain,
    folderPathPreview,
    folderSlug,
    indexFolders,
    isValidMoveTarget,
    siblingFolders,
} from "../../src/workflow/folder"
import type {Folder} from "../../src/workflow/folder"

const folder = (id: string, name: string, parent_id: string | null = null, slug = id): Folder => ({
    id,
    name,
    slug,
    parent_id,
})
const prompt = (id: string, name: string, folder_id: string | null, created_at: string) => ({
    id,
    name,
    folder_id,
    created_at,
})

const FOLDERS = [
    folder("b", "Beta"),
    folder("a", "Alpha"),
    folder("a1", "Drafts", "a", "drafts-v2"),
    folder("a2", "Archive", "a"),
]

describe("workflow folder tree", () => {
    it("Browse rows list subfolders first, then prompts newest first", () => {
        const prompts = [
            prompt("p1", "Old", null, "2026-01-01"),
            prompt("p2", "New", null, "2026-03-01"),
            prompt("p3", "Inside", "a", "2026-02-01"),
        ]
        const rows = browseRows({folders: FOLDERS, prompts, folderId: null})
        expect(rows.map((row) => row.id)).toEqual(["b", "a", "p2", "p1"])
        const inside = browseRows({folders: FOLDERS, prompts, folderId: "a"})
        expect(inside.map((row) => row.id)).toEqual(["a1", "a2", "p3"])
    })

    it("A prompt whose folder was deleted shows at the root", () => {
        const prompts = [prompt("p1", "Stranded", "deleted-folder", "2026-01-01")]
        expect(browseRows({folders: FOLDERS, prompts, folderId: null}).map((r) => r.id)).toContain(
            "p1",
        )
        const tree = buildFolderTree(FOLDERS, prompts)
        expect(tree.map((node) => node.id)).toContain("p1")
    })

    it("Search keeps matching items and their ancestor folders", () => {
        const prompts = [
            prompt("p1", "Welcome email", "a1", "2026-01-01"),
            prompt("p2", "Other", "a1", "2026-01-02"),
        ]
        const result = filterTreeBySearch(buildFolderTree(FOLDERS, prompts), "welcome")
        expect(result).toHaveLength(1)
        const alpha = result[0]
        expect(alpha.kind === "folder" && alpha.id).toBe("a")
        const drafts = alpha.kind === "folder" ? alpha.children : []
        expect(drafts.map((node) => node.id)).toEqual(["a1"])
        const leaves = drafts[0].kind === "folder" ? drafts[0].children : []
        expect(leaves.map((node) => node.id)).toEqual(["p1"])
    })

    it("Search is case insensitive", () => {
        const tree = buildFolderTree(FOLDERS, [])
        expect(filterTreeBySearch(tree, "BETA").map((node) => node.id)).toEqual(["b"])
        expect(filterTreeBySearch(tree, "  beta ").map((node) => node.id)).toEqual(["b"])
    })

    it("A folder cannot move into itself or a descendant", () => {
        const foldersById = indexFolders(FOLDERS)
        const item = {kind: "folder", id: "a"} as const
        expect(isValidMoveTarget({foldersById, item, destinationId: "a"})).toBe(false)
        expect(isValidMoveTarget({foldersById, item, destinationId: "a1"})).toBe(false)
        expect(isValidMoveTarget({foldersById, item, destinationId: "b"})).toBe(true)
    })

    it("A folder cannot move to its current parent", () => {
        const foldersById = indexFolders(FOLDERS)
        const item = {kind: "folder", id: "a1"} as const
        expect(isValidMoveTarget({foldersById, item, destinationId: "a"})).toBe(false)
        expect(isValidMoveTarget({foldersById, item, destinationId: "b"})).toBe(true)
        expect(isValidMoveTarget({foldersById, item, destinationId: null})).toBe(false)
        const promptItem = {kind: "prompt", id: "p", folderId: "a"} as const
        expect(isValidMoveTarget({foldersById, item: promptItem, destinationId: "a"})).toBe(false)
        expect(isValidMoveTarget({foldersById, item: promptItem, destinationId: "b"})).toBe(true)
    })

    it("Only a prompt inside a folder can move to the top level", () => {
        const foldersById = indexFolders(FOLDERS)
        const inFolder = {kind: "prompt", id: "p", folderId: "a"} as const
        const atTop = {kind: "prompt", id: "p", folderId: null} as const
        expect(isValidMoveTarget({foldersById, item: inFolder, destinationId: null})).toBe(true)
        expect(isValidMoveTarget({foldersById, item: atTop, destinationId: null})).toBe(false)
        const folder = {kind: "folder", id: "a1"} as const
        expect(isValidMoveTarget({foldersById, item: folder, destinationId: null})).toBe(false)
    })

    it("The slug keeps letters from any language", () => {
        expect(folderSlug("Données  clés")).toBe("données-clés")
        expect(folderSlug("  My Folder_1! ")).toBe("my-folder_1")
        expect(folderSlug("日本語 テスト")).toBe("日本語-テスト")
    })

    it("The path preview uses the stored slugs of the ancestors", () => {
        const foldersById = indexFolders(FOLDERS)
        expect(folderPathPreview(foldersById, "a1", "New one")).toBe("a/drafts-v2/new-one")
        expect(folderPathPreview(foldersById, null, "Top")).toBe("top")
        expect(folderPathPreview(foldersById, "a", "")).toBe("a")
    })

    it("Sibling folders are sorted by name", () => {
        const foldersById = indexFolders(FOLDERS)
        expect(siblingFolders(foldersById, null).map((f) => f.id)).toEqual(["a", "b"])
        expect(siblingFolders(foldersById, "a").map((f) => f.id)).toEqual(["a2", "a1"])
        expect(folderChain(foldersById, "a1").map((f) => f.id)).toEqual(["a", "a1"])
    })
})
