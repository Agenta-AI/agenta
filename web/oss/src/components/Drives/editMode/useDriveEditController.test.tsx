import {act, type RefObject, useLayoutEffect, useRef} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from "vitest"

import {TEXT_CAP} from "../driveKinds"

import {DriveEditBanner} from "./components/DriveEditBanner"
import {DriveEditBar} from "./components/DriveEditBar"
import {conflictFromListing} from "./model"
import {
    driveEditBufferAtom,
    openEditBufferAtom,
    requestNavigationAtom,
    setEditDraftAtom,
    type DriveEditBuffer,
    type NavigationIntent,
} from "./state"
import {
    type DriveEditController,
    useDriveEditController,
    useDriveEditGuard,
} from "./useDriveEditController"

const getMountFilesMock = vi.hoisted(() => vi.fn())
const uploadMountFileMock = vi.hoisted(() => vi.fn())

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => ({
        getMountFiles: getMountFilesMock,
        uploadMountFile: uploadMountFileMock,
    }),
    getLowPriorityMountsClient: () => ({getMountFiles: getMountFilesMock}),
    getSessionsClient: () => ({}),
    getLowPrioritySessionsClient: () => ({}),
}))

const reactActGlobal = globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
const mount = {id: "mount-a", slug: "mount-a", name: "Mount A", session_id: "session-a"}

const baseBuffer = {
    bufferId: "buffer-a",
    driveKey: "drive-a",
    targetMountId: "mount-a",
    targetPath: "notes.md",
    displayPath: "notes.md",
    scope: "session" as const,
    original: "original",
    baseMtime: 10,
    includeGitignored: false,
    supportsMarkdownPreview: true,
    language: "code" as const,
}

const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return {promise, resolve}
}

beforeAll(() => {
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
    delete reactActGlobal.IS_REACT_ACT_ENVIRONMENT
})

afterEach(() => {
    getMountFilesMock.mockReset()
    uploadMountFileMock.mockReset()
    vi.useRealTimers()
})

const seedMountReads = ({content = "original", mtime = 10} = {}) => {
    getMountFilesMock.mockImplementation((request: {read?: string}) =>
        Promise.resolve(
            request.read ? {content} : {files: [{path: "notes.md", size: content.length, mtime}]},
        ),
    )
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

async function waitFor(check: () => boolean) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (check()) return
        await flush()
    }
    throw new Error("Condition did not become true")
}

describe("useDriveEditController", () => {
    let root: Root | null = null
    let container: HTMLDivElement | null = null

    afterEach(() => {
        if (root) act(() => root?.unmount())
        container?.remove()
        root = null
        container = null
    })

    function mountController({
        store,
        driveKey = "drive-a",
        selectedPath = "notes.md",
        selectedSize = 8,
        select = vi.fn(),
        close = vi.fn(),
    }: {
        store: ReturnType<typeof createStore>
        driveKey?: string
        selectedPath?: string
        selectedSize?: number
        select?: (path: string | null) => void
        close?: () => void
    }) {
        let current: DriveEditController | null = null
        let rootElement: HTMLDivElement | null = null
        const Harness = () => {
            const rootRef = useRef<HTMLDivElement>(null)
            const controller = useDriveEditController({
                driveKey,
                resolveMountPath: (path) => ({mount, path}),
                selectedPath,
                selectedIsFolder: false,
                selectedSize,
                scope: "session",
                canEditMountFiles: true,
                includeGitignored: false,
                select,
                close,
                rootRef: rootRef as RefObject<HTMLElement | null>,
            })
            useLayoutEffect(() => {
                current = controller
                rootElement = rootRef.current
            }, [controller])
            return (
                <div ref={rootRef}>
                    <button type="button">inside</button>
                </div>
            )
        }
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => {
            root?.render(
                <Provider store={store}>
                    <Harness />
                </Provider>,
            )
        })
        return {
            get: () => current as DriveEditController,
            target: () => rootElement?.querySelector("button") as HTMLButtonElement,
            container: () => rootElement as HTMLDivElement,
        }
    }

    it("does not subscribe to file content when the listing size is over the cap", async () => {
        seedMountReads()
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))

        const controller = mountController({store, selectedSize: TEXT_CAP + 1})
        await waitFor(() => controller.get().availability === "too-large")

        expect(getMountFilesMock).not.toHaveBeenCalled()
    })

    it("keeps foreign edit state and chrome invisible to another controller", async () => {
        seedMountReads()
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(openEditBufferAtom, baseBuffer)
        let controllerB: DriveEditController | null = null
        const Probe = ({driveKey}: {driveKey: string}) => {
            const rootRef = useRef<HTMLDivElement>(null)
            const controller = useDriveEditController({
                driveKey,
                resolveMountPath: (path) => ({mount, path}),
                selectedPath: "notes.md",
                selectedIsFolder: false,
                selectedSize: 8,
                scope: "session",
                canEditMountFiles: true,
                includeGitignored: false,
                select: vi.fn(),
                close: vi.fn(),
                rootRef,
            })
            useLayoutEffect(() => {
                if (driveKey === "drive-b") controllerB = controller
            }, [controller, driveKey])
            return (
                <div ref={rootRef} data-drive={driveKey}>
                    <DriveEditBar driveKey={driveKey} />
                    <DriveEditBanner
                        driveKey={driveKey}
                        onRetry={controller.onSave}
                        onReload={controller.onReload}
                        onOverwrite={controller.onOverwrite}
                    />
                </div>
            )
        }
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        act(() =>
            root?.render(
                <Provider store={store}>
                    <Probe driveKey="drive-a" />
                    <Probe driveKey="drive-b" />
                </Provider>,
            ),
        )
        await waitFor(() => controllerB?.availability === "enabled")
        const driveB = container.querySelector('[data-drive="drive-b"]')

        expect(controllerB?.editing).toBe(false)
        expect(driveB?.textContent).not.toContain("Editing")
        expect(driveB?.textContent).not.toContain("changed while you were editing")
    })

    it("clears a clean owned buffer on unmount but preserves a dirty one", () => {
        seedMountReads()
        const cleanStore = createStore()
        cleanStore.set(projectIdAtom, "project")
        cleanStore.set(queryClientAtom, new QueryClient())
        cleanStore.set(openEditBufferAtom, baseBuffer)
        mountController({store: cleanStore})
        act(() => root?.unmount())
        root = null
        expect(cleanStore.get(driveEditBufferAtom)).toBeNull()

        const dirtyStore = createStore()
        dirtyStore.set(projectIdAtom, "project")
        dirtyStore.set(queryClientAtom, new QueryClient())
        dirtyStore.set(openEditBufferAtom, baseBuffer)
        dirtyStore.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"})
        mountController({store: dirtyStore})
        act(() => root?.unmount())
        root = null
        expect(dirtyStore.get(driveEditBufferAtom)?.draft).toBe("changed")
    })

    it("lets an in-flight real save settle after unmount", async () => {
        seedMountReads()
        const write = deferred<{path: string; size: number}>()
        uploadMountFileMock.mockReturnValue(write.promise)
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(openEditBufferAtom, baseBuffer)
        act(() => store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"}))
        const controller = mountController({store})

        act(() => controller.get().onSave())
        await waitFor(() => uploadMountFileMock.mock.calls.length === 1)
        act(() => root?.unmount())
        root = null
        write.resolve({path: "notes.md", size: 7})
        await flush()

        expect(store.get(driveEditBufferAtom)).toBeNull()
    })

    it("does not arm a later save after a no-op overwrite", async () => {
        seedMountReads()
        const write = deferred<{path: string; size: number}>()
        uploadMountFileMock.mockReturnValue(write.promise)
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(openEditBufferAtom, baseBuffer)
        store.set(driveEditBufferAtom, {
            ...(store.get(driveEditBufferAtom) as DriveEditBuffer),
            issue: {kind: "conflict", reason: "changed", theirMtime: 20},
        })
        const controller = mountController({store})

        act(() => controller.get().onOverwrite())
        expect(uploadMountFileMock).not.toHaveBeenCalled()
        act(() => store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"}))
        act(() => controller.get().onSave())
        await waitFor(() => uploadMountFileMock.mock.calls.length === 1)

        expect(getMountFilesMock).toHaveBeenCalledWith(
            expect.objectContaining({depth: 1}),
            expect.anything(),
        )
        await act(async () => {
            write.resolve({path: "notes.md", size: 7})
            await write.promise
        })
        await waitFor(() => store.get(driveEditBufferAtom) === null)
    })

    it("scopes shortcuts to the drawer root and respects a pending guard", async () => {
        seedMountReads()
        uploadMountFileMock.mockResolvedValue({path: "notes.md", size: 7})
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        const controller = mountController({store})
        await waitFor(() => controller.get().availability === "enabled")
        const outside = document.createElement("button")
        document.body.appendChild(outside)

        act(() =>
            outside.dispatchEvent(
                new KeyboardEvent("keydown", {key: "e", ctrlKey: true, bubbles: true}),
            ),
        )
        expect(store.get(driveEditBufferAtom)).toBeNull()

        act(() =>
            controller
                .target()
                .dispatchEvent(
                    new KeyboardEvent("keydown", {key: "e", ctrlKey: true, bubbles: true}),
                ),
        )
        await waitFor(() => store.get(driveEditBufferAtom) !== null)
        act(() => {
            store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"})
            store.set(requestNavigationAtom, {driveKey: "drive-a", intent: {kind: "close"}})
        })

        act(() => {
            controller
                .target()
                .dispatchEvent(
                    new KeyboardEvent("keydown", {key: "s", ctrlKey: true, bubbles: true}),
                )
            controller
                .target()
                .dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })

        expect(uploadMountFileMock).not.toHaveBeenCalled()
        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toEqual({kind: "close"})
        outside.remove()
    })

    it("runs Cmd+S and Escape from inside the drawer", async () => {
        seedMountReads()
        const write = deferred<{path: string; size: number}>()
        uploadMountFileMock.mockReturnValue(write.promise)
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"})
        const controller = mountController({store})

        act(() =>
            controller
                .target()
                .dispatchEvent(
                    new KeyboardEvent("keydown", {key: "s", metaKey: true, bubbles: true}),
                ),
        )
        await waitFor(() => uploadMountFileMock.mock.calls.length === 1)
        expect(store.get(driveEditBufferAtom)?.inflightRequestId).toEqual(expect.any(String))
        act(() => controller.get().onCancel())
        expect(controller.get().statusText).toBe("Saving — wait before leaving")
        write.resolve({path: "notes.md", size: 7})
        await flush()

        act(() => {
            store.set(openEditBufferAtom, {...baseBuffer, bufferId: "buffer-b"})
            store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed again"})
        })
        await waitFor(() => controller.get().editing && controller.get().dirty)
        act(() =>
            controller
                .target()
                .dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})),
        )

        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toEqual({kind: "cancel"})
    })

    it("guards selection except for the already-selected path", () => {
        seedMountReads()
        const select = vi.fn()
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient())
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"})
        const controller = mountController({store, select})

        act(() => controller.get().select("notes.md"))
        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toBeNull()
        expect(select).not.toHaveBeenCalled()

        act(() => controller.get().select("other.md"))
        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toEqual({
            kind: "select",
            path: "other.md",
        })
        expect(select).not.toHaveBeenCalled()
    })

    it("registers and deregisters beforeunload only while dirty", () => {
        seedMountReads()
        const add = vi.spyOn(window, "addEventListener")
        const remove = vi.spyOn(window, "removeEventListener")
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient())
        store.set(openEditBufferAtom, baseBuffer)
        mountController({store})

        act(() => store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"}))
        expect(add).toHaveBeenCalledWith("beforeunload", expect.any(Function))
        act(() => store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "original"}))
        expect(remove).toHaveBeenCalledWith("beforeunload", expect.any(Function))

        add.mockRestore()
        remove.mockRestore()
    })

    it("shows Saved for the selected path and clears it after two seconds", async () => {
        seedMountReads()
        uploadMountFileMock.mockResolvedValue({path: "notes.md", size: 7})
        const timer = vi.spyOn(window, "setTimeout")
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"})
        const controller = mountController({store})

        act(() => controller.get().onSave())
        await waitFor(() => controller.get().justSaved)
        expect(controller.get().statusText).toBe("Saved")

        const callback = timer.mock.calls.find(([, delay]) => delay === 2_000)?.[0]
        expect(callback).toBeTypeOf("function")
        act(() => (callback as () => void)())
        expect(controller.get().justSaved).toBe(false)
        timer.mockRestore()
    })
})

describe("reload lifecycle", () => {
    let root: Root | null = null
    let container: HTMLDivElement | null = null

    afterEach(() => {
        if (root) act(() => root?.unmount())
        container?.remove()
        root = null
        container = null
    })

    it("blocks draft writes, adopts remote bytes, and refreshes the baseline", async () => {
        const contentRead = deferred<{content: string}>()
        getMountFilesMock.mockImplementation((request: {read?: string}) =>
            request.read
                ? contentRead.promise
                : Promise.resolve({files: [{path: "notes.md", size: 6, mtime: 20}]}),
        )
        const store = createStore()
        store.set(projectIdAtom, "project")
        store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
        store.set(openEditBufferAtom, baseBuffer)
        store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "changed"})
        store.set(driveEditBufferAtom, {
            ...(store.get(driveEditBufferAtom) as DriveEditBuffer),
            issue: {kind: "conflict", reason: "changed", theirMtime: 15},
        })
        store.set(requestNavigationAtom, {driveKey: "drive-a", intent: {kind: "reload"}})
        let guard: ReturnType<typeof useDriveEditGuard> | null = null
        const Harness = () => {
            const current = useDriveEditGuard({
                active: true,
                initialPath: "notes.md",
                driveKey: "drive-a",
                heldDriveKey: "drive-a",
                onClose: vi.fn(),
                runNavigation: (_intent: NavigationIntent) => undefined,
            })
            useLayoutEffect(() => {
                guard = current
            }, [current])
            return null
        }
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
        act(() =>
            root?.render(
                <Provider store={store}>
                    <Harness />
                </Provider>,
            ),
        )

        act(() => guard?.modal.onDiscard())
        expect(store.get(driveEditBufferAtom)?.reloading).toBe(true)
        store.set(setEditDraftAtom, {driveKey: "drive-a", draft: "typed during reload"})
        expect(store.get(driveEditBufferAtom)?.draft).toBe("changed")
        contentRead.resolve({content: "remote"})
        await waitFor(() => store.get(driveEditBufferAtom)?.reloading === false)

        const buffer = store.get(driveEditBufferAtom)
        expect(buffer).toMatchObject({original: "remote", draft: "remote", baseMtime: 20})
        expect(
            conflictFromListing([{path: "notes.md", mtime: 30}], "notes.md", buffer!.baseMtime),
        ).toEqual({
            reason: "changed",
            theirMtime: 30,
        })
    })
})
