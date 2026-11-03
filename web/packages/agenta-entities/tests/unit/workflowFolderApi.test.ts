/**
 * The prompt folder calls go through the generated client: the request each one sends, and the
 * answer it hands back after the zod check.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const folders = {
    queryFolders: vi.fn(),
    createFolder: vi.fn(),
    editFolder: vi.fn(),
    deleteFolder: vi.fn(),
}
const workflows = {editWorkflow: vi.fn()}

vi.mock("@agenta/sdk/resources", () => ({
    getFoldersClient: () => folders,
    getWorkflowsClient: () => workflows,
}))

import {
    createFolder,
    deleteFolder,
    moveFolder,
    moveWorkflowToFolder,
    queryFolders,
    renameFolder,
    renameWorkflow,
} from "../../src/workflow/folder"

const PROJECT = {queryParams: {project_id: "project-1"}}

beforeEach(() => {
    vi.clearAllMocks()
})

describe("workflow folder api", () => {
    it("Query folders sends the project id and the parent filter", async () => {
        folders.queryFolders.mockResolvedValue({count: 1, folders: [{id: "f1", name: "A"}]})

        const root = await queryFolders({projectId: "project-1", parentId: null})
        await queryFolders({projectId: "project-1", parentId: "f1"})
        await queryFolders({projectId: "project-1"})

        expect(root).toEqual([{id: "f1", name: "A"}])
        expect(folders.queryFolders).toHaveBeenNthCalledWith(
            1,
            {folder: {parent_id: null}},
            PROJECT,
        )
        expect(folders.queryFolders).toHaveBeenNthCalledWith(
            2,
            {folder: {parent_id: "f1"}},
            PROJECT,
        )
        expect(folders.queryFolders).toHaveBeenNthCalledWith(3, {folder: {}}, PROJECT)
    })

    it("Create folder sends kind applications and the parent id", async () => {
        folders.createFolder.mockResolvedValue({count: 1, folder: {id: "f2", name: "B"}})

        const created = await createFolder({
            projectId: "project-1",
            name: "B",
            slug: "b",
            parentId: "f1",
        })

        expect(created).toEqual({id: "f2", name: "B"})
        expect(folders.createFolder).toHaveBeenCalledWith(
            {folder: {name: "B", slug: "b", kind: "applications", parent_id: "f1"}},
            PROJECT,
        )
    })

    it("Rename folder sends the id, the name and the new slug", async () => {
        folders.editFolder.mockResolvedValue({count: 1, folder: {id: "f2"}})

        await renameFolder({projectId: "project-1", folderId: "f2", name: "C d", slug: "c-d"})

        expect(folders.editFolder).toHaveBeenCalledWith(
            {folder_id: "f2", folder: {id: "f2", name: "C d", slug: "c-d"}},
            PROJECT,
        )
    })

    it("Move folder sends the destination as parent id", async () => {
        folders.editFolder.mockResolvedValue({count: 1, folder: {id: "f2"}})

        await moveFolder({
            projectId: "project-1",
            folder: {id: "f2", name: "B", slug: "b"},
            destinationId: "f9",
        })

        expect(folders.editFolder).toHaveBeenCalledWith(
            {
                folder_id: "f2",
                folder: {id: "f2", name: "B", slug: "b", kind: "applications", parent_id: "f9"},
            },
            PROJECT,
        )
    })

    it("Move prompt sends only the workflow id and the folder id", async () => {
        workflows.editWorkflow.mockResolvedValue({})

        await moveWorkflowToFolder({projectId: "project-1", workflowId: "w1", folderId: "f9"})

        expect(workflows.editWorkflow).toHaveBeenCalledWith(
            {workflow_id: "w1", workflow: {id: "w1", folder_id: "f9"}},
            PROJECT,
        )
    })

    it("A folder response that fails the schema returns an empty list and logs", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
        folders.queryFolders.mockResolvedValue({count: 1, folders: [{name: "no id"}]})

        expect(await queryFolders({projectId: "project-1"})).toEqual([])
        expect(log).toHaveBeenCalled()
        log.mockRestore()
    })

    // Documents what the API does today (P29). The web client sends one request for the
    // folder; the server removes the subfolders in the same statement (a DELETE on the folder
    // path and every path below it) and the database sets `folder_id` to null on the
    // workflows in them (`ondelete="SET NULL"`). The client has no cleanup call to make.
    it("Delete folder sends one request for the folder and nothing for subfolders or prompts", async () => {
        folders.deleteFolder.mockResolvedValue({count: 1, id: "f1"})

        await deleteFolder({projectId: "project-1", folderId: "f1"})

        expect(folders.deleteFolder).toHaveBeenCalledTimes(1)
        expect(folders.deleteFolder).toHaveBeenCalledWith({folder_id: "f1"}, PROJECT)
        expect(folders.queryFolders).not.toHaveBeenCalled()
        expect(workflows.editWorkflow).not.toHaveBeenCalled()
    })

    it("Rename prompt sends the name and the description as a metadata edit", async () => {
        await renameWorkflow({
            projectId: "project-1",
            workflowId: "w1",
            name: "Welcome",
            description: "Hi",
        })

        expect(workflows.editWorkflow).toHaveBeenCalledWith(
            {workflow_id: "w1", workflow: {id: "w1", name: "Welcome", description: "Hi"}},
            PROJECT,
        )
    })
})
