import {createElement, useLayoutEffect} from "react"
import {act} from "react"

import {mountDirQueryKey, mountFileContentQueryKey, writeMountFile} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest"

import {saveDriveFile, type SaveDriveFileDependencies} from "./api"
import {
    driveEditBufferAtom,
    editSaveSucceededAtom,
    openEditBufferAtom,
    setEditDraftAtom,
    startEditSaveAtom,
    type NavigationIntent,
} from "./state"
import {useDriveEditGuard} from "./useDriveEditController"

const uploadMountFileMock = vi.hoisted(() => vi.fn())
const reactActGlobal = globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => ({uploadMountFile: uploadMountFileMock}),
    getLowPriorityMountsClient: () => ({}),
    getSessionsClient: () => ({}),
    getLowPrioritySessionsClient: () => ({}),
}))

beforeAll(() => {
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
    delete reactActGlobal.IS_REACT_ACT_ENVIRONMENT
})

const baseBuffer = {
    bufferId: "buffer-a",
    driveKey: "drive-a",
    targetMountId: "mount-a",
    targetPath: "notes/a.md",
    displayPath: "notes/a.md",
    scope: "session" as const,
    original: "original",
    baseMtime: 10,
    mode: "markdown" as const,
    language: "code" as const,
}

const saveDependencies = ({
    listing = [{path: "notes/a.md", size: 8, mtime: 10}],
    size = 7,
}: {
    listing?: {path: string; size: number; mtime: number | null}[]
    size?: number
} = {}) => {
    const queryDir = vi.fn().mockResolvedValue(listing)
    const writeFile = vi.fn().mockResolvedValue({ok: true as const, size})
    const dependencies: SaveDriveFileDependencies = {queryDir, writeFile}
    return {dependencies, queryDir, writeFile}
}

afterEach(() => {
    uploadMountFileMock.mockReset()
})

describe("saveDriveFile", () => {
    it("treats a missing listing entry as a conflict", async () => {
        const queryClient = new QueryClient()
        const {dependencies, writeFile} = saveDependencies({listing: []})

        const result = await saveDriveFile(
            {
                queryClient,
                projectId: "project",
                targetMountId: "mount-a",
                targetPath: "notes/a.md",
                draft: "changed",
                baseMtime: 10,
                includeGitignored: false,
                skipConflictCheck: false,
            },
            dependencies,
        )

        expect(result).toEqual({kind: "conflict", reason: "missing", theirMtime: null})
        expect(writeFile).not.toHaveBeenCalled()
    })

    it("keys the pre-write fetch with includeGitignored", async () => {
        const queryClient = new QueryClient()
        const {dependencies} = saveDependencies()

        await saveDriveFile(
            {
                queryClient,
                projectId: "project",
                targetMountId: "mount-a",
                targetPath: "notes/a.md",
                draft: "changed",
                baseMtime: 10,
                includeGitignored: true,
                skipConflictCheck: false,
            },
            dependencies,
        )

        expect(
            queryClient.getQueryState(mountDirQueryKey("project", "mount-a", "notes", true)),
        ).toBeDefined()
    })

    it("uses the resolved agent mount for the fetch, write, and content seed", async () => {
        const queryClient = new QueryClient()
        const {dependencies, queryDir, writeFile} = saveDependencies({
            listing: [{path: "x.md", size: 4, mtime: 5}],
        })

        const result = await saveDriveFile(
            {
                queryClient,
                projectId: "project",
                targetMountId: "agent-mount",
                targetPath: "x.md",
                draft: "exact draft\n",
                baseMtime: 5,
                includeGitignored: false,
                skipConflictCheck: false,
            },
            dependencies,
        )

        expect(result.kind).toBe("saved")
        expect(queryDir).toHaveBeenCalledWith(expect.objectContaining({mountId: "agent-mount"}))
        expect(writeFile).toHaveBeenCalledWith(
            expect.objectContaining({mountId: "agent-mount", path: "x.md"}),
        )
        expect(
            queryClient.getQueryData(mountFileContentQueryKey("project", "agent-mount", "x.md")),
        ).toBe("exact draft\n")
    })

    it("seeds the exact draft and invalidates all four listing roots", async () => {
        const queryClient = new QueryClient()
        const invalidate = vi.spyOn(queryClient, "invalidateQueries")
        const {dependencies} = saveDependencies()

        await saveDriveFile(
            {
                queryClient,
                projectId: "project",
                targetMountId: "mount-a",
                targetPath: "notes/a.md",
                draft: "raw\n\n",
                baseMtime: 10,
                includeGitignored: false,
                skipConflictCheck: false,
            },
            dependencies,
        )

        expect(
            queryClient.getQueryData(mountFileContentQueryKey("project", "mount-a", "notes/a.md")),
        ).toBe("raw\n\n")
        expect(invalidate.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
            ["mounts", "files", "project"],
            ["mounts", "files-latest", "project"],
            ["mounts", "files-root", "project"],
            ["mounts", "files-dir", "project"],
        ])
    })
})

describe("writeMountFile", () => {
    it("sends multipart content with the full path and disables retries", async () => {
        uploadMountFileMock.mockResolvedValue({path: "nested/a.md", size: 6})

        await expect(
            writeMountFile({
                projectId: "project",
                mountId: "mount",
                path: "nested/a.md",
                content: "hello\n",
            }),
        ).resolves.toEqual({ok: true, size: 6})

        const [request, options] = uploadMountFileMock.mock.calls[0]
        expect(request).toMatchObject({mount_id: "mount", path: "nested/a.md"})
        expect(request.file.filename).toBe("a.md")
        expect(request.file.data).toBeInstanceOf(Blob)
        expect(request.file.data).toMatchObject({size: 6, type: "text/plain;charset=utf-8"})
        expect(options).toMatchObject({
            queryParams: {project_id: "project"},
            maxRetries: 0,
            timeoutInSeconds: 30,
        })
    })
})

describe("stale save completion", () => {
    it("does not mutate a replacement buffer", () => {
        const store = createStore()
        store.set(openEditBufferAtom, baseBuffer)
        store.set(startEditSaveAtom, "request-a")
        store.set(driveEditBufferAtom, null)
        store.set(openEditBufferAtom, {
            ...baseBuffer,
            bufferId: "buffer-b",
            targetPath: "notes/b.md",
            displayPath: "notes/b.md",
        })

        store.set(editSaveSucceededAtom, "request-a")

        expect(store.get(driveEditBufferAtom)?.bufferId).toBe("buffer-b")
    })
})

describe("useDriveEditGuard", () => {
    let root: Root | null = null
    let container: HTMLDivElement | null = null

    afterEach(() => {
        if (root) act(() => root?.unmount())
        container?.remove()
        root = null
        container = null
    })

    function mountGuard({
        initialPath,
        store,
        onClose,
        runNavigation = vi.fn(),
        driveKey = "drive-a",
        heldDriveKey = "drive-a",
    }: {
        initialPath: string
        store: ReturnType<typeof createStore>
        onClose: () => void
        runNavigation?: (intent: NavigationIntent) => void
        driveKey?: string
        heldDriveKey?: string
    }) {
        let current: ReturnType<typeof useDriveEditGuard> | null = null
        const Harness = ({path, currentDriveKey}: {path: string; currentDriveKey: string}) => {
            const value = useDriveEditGuard({
                active: true,
                initialPath: path,
                driveKey: currentDriveKey,
                heldDriveKey,
                onClose,
                runNavigation,
            })
            useLayoutEffect(() => {
                current = value
            }, [value])
            return null
        }
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        const render = (path: string) =>
            act(() => {
                root?.render(
                    createElement(
                        Provider,
                        {store},
                        createElement(Harness, {path, currentDriveKey: driveKey}),
                    ),
                )
            })
        render(initialPath)
        return {get: () => current as ReturnType<typeof useDriveEditGuard>, render}
    }

    it("routes a shell close through the dirty guard", () => {
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient())
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, "changed")
        const onClose = vi.fn()
        const guard = mountGuard({initialPath: "notes/a.md", store, onClose})

        act(() => guard.get().onClose())

        expect(onClose).not.toHaveBeenCalled()
        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toEqual({kind: "close"})
        act(() => guard.get().modal.onDiscard())
        expect(onClose).toHaveBeenCalledOnce()
    })

    it("holds a changed initialPath while a dirty buffer is guarded", () => {
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient())
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, "changed")
        const runNavigation = vi.fn()
        const guard = mountGuard({
            initialPath: "notes/a.md",
            store,
            onClose: vi.fn(),
            runNavigation,
        })

        guard.render("notes/b.md")

        expect(guard.get().initialPath).toBe("notes/a.md")
        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toEqual({
            kind: "select",
            path: "notes/b.md",
        })
        act(() => guard.get().modal.onDiscard())
        expect(runNavigation).toHaveBeenCalledWith({kind: "select", path: "notes/b.md"})
    })

    it("keeps the previous drive mounted after accepting a drive-swap guard", () => {
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient())
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, "changed")
        const guard = mountGuard({
            initialPath: "notes/a.md",
            store,
            onClose: vi.fn(),
            driveKey: "drive-b",
            heldDriveKey: "drive-a",
        })

        expect(guard.get().holdDrive).toBe(true)
        expect(guard.get().modal.open).toBe(true)
        act(() => guard.get().modal.onKeep())
        expect(guard.get().holdDrive).toBe(true)
        expect(guard.get().modal.open).toBe(false)
    })

    it("releases a discarded drive swap without selecting in the held drive", () => {
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient())
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, "changed")
        const runNavigation = vi.fn()
        const guard = mountGuard({
            initialPath: "notes/new-drive.md",
            store,
            onClose: vi.fn(),
            runNavigation,
            driveKey: "drive-b",
            heldDriveKey: "drive-a",
        })

        act(() => guard.get().modal.onDiscard())

        expect(store.get(driveEditBufferAtom)).toBeNull()
        expect(runNavigation).not.toHaveBeenCalled()
    })
})
