import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {queryFolders} = vi.hoisted(() => ({queryFolders: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getFoldersClient: () => ({queryFolders}),
    getWorkflowsClient: () => ({}),
}))
vi.mock("../../src/workflow/folder/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/workflow/folder/api")>()),
    queryFolders,
}))

import type {Workflow} from "../../src/workflow/core/schema"
import {
    invalidateProjectFolders,
    projectFoldersListQueryStateAtom,
    projectFoldersQueryAtom,
} from "../../src/workflow/folder"
import {toWorkflowListRef} from "../../src/workflow/state/store"

const makeStore = () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, "project-1")
    store.set(sessionAtom, true)
    return {store, queryClient}
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
    queryFolders.mockReset()
})

describe("workflow folder state", () => {
    it("Prompt list rows carry their folder id", () => {
        const inFolder = toWorkflowListRef({id: "w1", folder_id: "f1"} as Workflow)
        const loose = toWorkflowListRef({id: "w2"} as Workflow)
        expect(inFolder.folder_id).toBe("f1")
        expect(loose.folder_id).toBeNull()
    })

    it("Folders query reports pending, then the folders", async () => {
        queryFolders.mockResolvedValue([{id: "f1", name: "Alpha"}])
        const {store} = makeStore()
        store.sub(projectFoldersListQueryStateAtom, () => undefined)

        expect(store.get(projectFoldersListQueryStateAtom).isPending).toBe(true)
        await settle()
        const state = store.get(projectFoldersListQueryStateAtom)
        expect(state.isPending).toBe(false)
        expect(state.data).toEqual([{id: "f1", name: "Alpha"}])
        expect(queryFolders).toHaveBeenCalledWith({projectId: "project-1"})
    })

    it("A failed folders query reports an error, not an empty list", async () => {
        queryFolders.mockRejectedValue(new Error("network down"))
        const {store} = makeStore()
        store.sub(projectFoldersListQueryStateAtom, () => undefined)

        await settle()
        const state = store.get(projectFoldersListQueryStateAtom)
        expect(state.isError).toBe(true)
        expect(state.data).toEqual([])
    })

    it("Invalidating folders refetches the folders query", async () => {
        queryFolders.mockResolvedValueOnce([{id: "f1", name: "Alpha"}])
        const {store, queryClient} = makeStore()
        store.sub(projectFoldersQueryAtom, () => undefined)
        await settle()

        queryFolders.mockResolvedValueOnce([
            {id: "f1", name: "Alpha"},
            {id: "f2", name: "Beta"},
        ])
        await invalidateProjectFolders(queryClient)
        await settle()

        expect(queryFolders).toHaveBeenCalledTimes(2)
        expect(store.get(projectFoldersListQueryStateAtom).data).toHaveLength(2)
    })
})
