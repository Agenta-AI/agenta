// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const api = vi.hoisted(() => ({
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    moveFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveWorkflowToFolder: vi.fn(),
    archiveWorkflow: vi.fn(),
}))
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))
const permissions = vi.hoisted(() => ({edit_folders: true, edit_workflows: true}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
    ...api,
}))
vi.mock("@agenta/ui/app-message", () => ({message: toast}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: "edit_folders" | "edit_workflows") =>
        permissions[action],
}))

import {usePromptFolderActions} from "@/features/prompts/usePromptFolderActions"

import {makePromptsStore, PromptsTestProviders, PROJECT_ID} from "./promptsTestStore"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const FOLDERS = [
    {id: "f1", name: "Alpha", slug: "alpha"},
    {id: "f2", name: "Beta", slug: "beta", parent_id: "f1"},
    {id: "f3", name: "Gamma", slug: "gamma"},
]
const openFolder = vi.fn()

describe("usePromptFolderActions", () => {
    let root: Root
    let latest: ReturnType<typeof usePromptFolderActions>
    let invalidate: ReturnType<typeof vi.spyOn>

    const Probe = ({folderId}: {folderId: string | null}) => {
        latest = usePromptFolderActions({
            folderId,
            foldersById: new Map(FOLDERS.map((f) => [f.id, f])),
            openFolder,
        })
        return null
    }

    const mount = (folderId: string | null = null) => {
        const {store, queryClient} = makePromptsStore({folders: FOLDERS, prompts: []})
        invalidate = vi.spyOn(queryClient, "invalidateQueries")
        act(() =>
            root.render(
                <PromptsTestProviders store={store} queryClient={queryClient}>
                    <Probe folderId={folderId} />
                </PromptsTestProviders>,
            ),
        )
    }

    beforeEach(() => {
        root = createRoot(document.createElement("div"))
        vi.clearAllMocks()
        permissions.edit_folders = true
        permissions.edit_workflows = true
        for (const fn of Object.values(api)) fn.mockResolvedValue(null)
    })
    afterEach(() => act(() => root.unmount()))

    const invalidatedKeys = () =>
        (invalidate.mock.calls as unknown as [{queryKey: string[]}][]).map(
            ([filters]) => filters.queryKey[0],
        )

    it("Creating a folder shows Folder created and refetches folders", async () => {
        mount("f1")
        let result
        await act(async () => {
            result = await latest.createFolder("  New one ")
        })
        expect(result).toEqual({ok: true})
        expect(api.createFolder).toHaveBeenCalledWith({
            projectId: PROJECT_ID,
            name: "New one",
            slug: "new-one",
            parentId: "f1",
        })
        expect(toast.success).toHaveBeenCalledWith("Folder created")
        expect(invalidatedKeys()).toContain("folders")
    })

    it("A 409 on create shows the API sentence and keeps the dialog open", async () => {
        const sentence = "A folder with this path already exists in this project."
        api.createFolder.mockRejectedValue({statusCode: 409, body: {detail: sentence}})
        mount()
        let result
        await act(async () => {
            result = await latest.createFolder("Alpha")
        })
        expect(result).toEqual({ok: false, error: sentence})
        expect(toast.success).not.toHaveBeenCalled()
    })

    it("A failure without an API sentence shows Couldn't save the folder", async () => {
        api.createFolder.mockRejectedValue(new Error("socket hang up"))
        api.renameFolder.mockRejectedValue({statusCode: 500, body: {detail: "boom: stack trace"}})
        mount()
        let created
        let renamed
        await act(async () => {
            created = await latest.createFolder("Alpha")
            renamed = await latest.renameFolder(FOLDERS[0], "Alpha 2")
        })
        expect(created).toEqual({ok: false, error: "Couldn't save the folder"})
        expect(renamed).toEqual({ok: false, error: "Couldn't save the folder"})
    })

    it("Deleting the open folder opens its parent", async () => {
        mount("f2")
        await act(async () => {
            await latest.deleteFolder(FOLDERS[0])
        })
        expect(api.deleteFolder).toHaveBeenCalledWith({projectId: PROJECT_ID, folderId: "f1"})
        // f2 sits below f1, so it goes with it: the parent of the deleted folder opens.
        expect(openFolder).toHaveBeenCalledWith(null)
        expect(toast.success).toHaveBeenCalledWith("Folder deleted")
        expect(invalidatedKeys()).toEqual(expect.arrayContaining(["folders", "workflows"]))
    })

    it("Deleting a folder that is not open leaves the open folder alone", async () => {
        mount("f3")
        await act(async () => {
            await latest.deleteFolder(FOLDERS[1])
        })
        expect(openFolder).not.toHaveBeenCalled()
    })

    it("Moving a prompt shows Prompt moved and refetches prompts", async () => {
        mount()
        await act(async () => {
            await latest.movePrompt({id: "p1", folder_id: null}, "f3")
        })
        expect(api.moveWorkflowToFolder).toHaveBeenCalledWith({
            projectId: PROJECT_ID,
            workflowId: "p1",
            folderId: "f3",
        })
        expect(toast.success).toHaveBeenCalledWith("Prompt moved")
        expect(invalidatedKeys()).toContain("workflows")
    })

    it("Moving a folder into itself sends no request", async () => {
        mount()
        let result
        await act(async () => {
            result = await latest.moveFolder(FOLDERS[0], "f2")
        })
        expect(result).toEqual({ok: false, error: "Cannot move a folder into itself"})
        expect(api.moveFolder).not.toHaveBeenCalled()
    })

    it("Archiving a prompt shows Prompt archived", async () => {
        mount()
        await act(async () => {
            await latest.archivePrompt({id: "p1"})
        })
        expect(api.archiveWorkflow).toHaveBeenCalledWith(PROJECT_ID, "p1")
        expect(toast.success).toHaveBeenCalledWith("Prompt archived")
    })

    it("A second confirm while the request runs sends no second request", async () => {
        let finish: () => void = () => undefined
        api.createFolder.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
        mount()
        await act(async () => {
            void latest.createFolder("One")
            void latest.createFolder("One")
        })
        expect(api.createFolder).toHaveBeenCalledTimes(1)
        expect(latest.pending).toBe(true)
        await act(async () => finish())
        expect(latest.pending).toBe(false)
    })

    it("Without edit_folders the folder actions are not offered", async () => {
        permissions.edit_folders = false
        mount()
        expect(latest.canEditFolders).toBe(false)
        await act(async () => {
            await latest.createFolder("Nope")
        })
        expect(api.createFolder).not.toHaveBeenCalled()
    })

    it("Without edit_workflows the prompt actions are not offered", async () => {
        permissions.edit_workflows = false
        mount()
        expect(latest.canEditPrompts).toBe(false)
        expect(latest.canEditFolders).toBe(true)
        await act(async () => {
            await latest.archivePrompt({id: "p1"})
        })
        expect(api.archiveWorkflow).not.toHaveBeenCalled()
    })
})
