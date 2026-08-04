import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    driveEditBufferAtom,
    driveEditDirtyAtomFamily,
    driveEditingAtomFamily,
    driveEditIssueAtomFamily,
    driveEditPendingNavigationAtomFamily,
    editReloadFailedAtom,
    editSaveFailedAtom,
    editSaveSucceededAtom,
    markEditConflictAtom,
    markNavigationBlockedWhileSavingAtom,
    openEditBufferAtom,
    replaceBufferFromRemoteAtom,
    requestNavigationAtom,
    resolveNavigationAtom,
    setEditDraftAtom,
    setEditorViewAtom,
    showTeardownNoticeAtom,
    startEditReloadAtom,
    startEditSaveAtom,
    type DriveEditBuffer,
    type NavigationIntent,
    type OpenDriveEditBufferInput,
} from "./state"

const baseInput: OpenDriveEditBufferInput = {
    bufferId: "buffer-a",
    driveKey: "drive-a",
    targetMountId: "mount-a",
    targetPath: "notes.txt",
    displayPath: "agent-files/notes.txt",
    scope: "app",
    original: "original\n",
    baseMtime: 100,
    includeGitignored: false,
    supportsMarkdownPreview: false,
    language: "code",
}

const open = (
    store: ReturnType<typeof createStore>,
    overrides: Partial<OpenDriveEditBufferInput> = {},
) => {
    store.set(openEditBufferAtom, {...baseInput, ...overrides})
    return store.get(driveEditBufferAtom)!
}

const setDraft = (store: ReturnType<typeof createStore>, draft: string, driveKey = "drive-a") => {
    store.set(setEditDraftAtom, {driveKey, draft})
}

const request = (
    store: ReturnType<typeof createStore>,
    intent: NavigationIntent,
    driveKey = "drive-a",
) => store.set(requestNavigationAtom, {driveKey, intent})

describe("drive edit state", () => {
    it("scopes editing and dirty selectors to the owning drive", () => {
        const store = createStore()
        open(store)

        expect(store.get(driveEditingAtomFamily("drive-a"))).toBe(true)
        expect(store.get(driveEditingAtomFamily("drive-b"))).toBe(false)
        setDraft(store, "changed\n")
        expect(store.get(driveEditDirtyAtomFamily("drive-a"))).toBe(true)
        expect(store.get(driveEditDirtyAtomFamily("drive-b"))).toBe(false)
        expect(store.get(driveEditIssueAtomFamily("drive-b"))).toBeNull()
    })

    it("opens clean, becomes dirty, and becomes clean after restoring the original", () => {
        const store = createStore()
        open(store)

        expect(store.get(driveEditDirtyAtomFamily("drive-a"))).toBe(false)
        setDraft(store, "changed\n")
        expect(store.get(driveEditDirtyAtomFamily("drive-a"))).toBe(true)
        setDraft(store, "original\n")
        expect(store.get(driveEditDirtyAtomFamily("drive-a"))).toBe(false)
    })

    it("updates the editor view without changing the buffer contents", () => {
        const store = createStore()
        open(store, {supportsMarkdownPreview: true})

        store.set(setEditorViewAtom, {driveKey: "drive-a", editorView: "preview"})

        expect(store.get(driveEditBufferAtom)).toMatchObject({
            original: "original\n",
            draft: "original\n",
            editorView: "preview",
        })
    })

    it("runs clean navigation immediately even when an old issue exists", () => {
        const store = createStore()
        const buffer = open(store)
        store.set(driveEditBufferAtom, {
            ...buffer,
            issue: {kind: "error", message: "old failure"},
        })
        const intent: NavigationIntent = {kind: "select", path: "other.txt"}

        expect(request(store, intent)).toEqual(intent)
        expect(store.get(driveEditBufferAtom)).toBeNull()
    })

    it("guards dirty navigation and records the pending intent", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed\n")
        const intent: NavigationIntent = {kind: "close"}

        expect(request(store, intent)).toBeNull()
        expect(store.get(driveEditPendingNavigationAtomFamily("drive-a"))).toEqual(intent)
    })

    it("lets a foreign drive navigate without mutating the owned buffer", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed\n")
        const before = store.get(driveEditBufferAtom)
        const intent: NavigationIntent = {kind: "close"}

        expect(request(store, intent, "drive-b")).toEqual(intent)
        expect(store.get(driveEditBufferAtom)).toEqual(before)
    })

    it("keeps or discards guarded navigation", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed\n")
        request(store, {kind: "close"})
        const before = store.get(driveEditBufferAtom)

        expect(
            store.set(resolveNavigationAtom, {driveKey: "drive-a", resolution: "keep"}),
        ).toBeNull()
        expect(store.get(driveEditBufferAtom)).toEqual({...before, pendingNavigation: null})

        request(store, {kind: "close"})
        expect(
            store.set(resolveNavigationAtom, {driveKey: "drive-a", resolution: "discard"}),
        ).toEqual({kind: "close"})
        expect(store.get(driveEditBufferAtom)).toBeNull()
    })

    it("keeps the buffer when discard resolves to reload", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed\n")
        request(store, {kind: "reload"})

        expect(
            store.set(resolveNavigationAtom, {driveKey: "drive-a", resolution: "discard"}),
        ).toEqual({kind: "reload"})
        expect(store.get(driveEditBufferAtom)).toMatchObject({
            bufferId: "buffer-a",
            draft: "changed\n",
            pendingNavigation: null,
        })
    })

    it("queues a clean reload without opening a discard path for other navigation", () => {
        const store = createStore()
        open(store)

        expect(request(store, {kind: "reload"})).toBeNull()
        expect(store.get(driveEditBufferAtom)).toMatchObject({
            bufferId: "buffer-a",
            pendingNavigation: {kind: "reload"},
        })
    })

    it("ignores draft changes while saving or reloading", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed\n")
        store.set(startEditSaveAtom, "save-a")
        setDraft(store, "typed during save")
        expect(store.get(driveEditBufferAtom)?.draft).toBe("changed\n")

        store.set(editSaveFailedAtom, {requestId: "save-a", message: "failed"})
        store.set(startEditReloadAtom, "reload-a")
        setDraft(store, "typed during reload")
        expect(store.get(driveEditBufferAtom)?.draft).toBe("changed\n")
    })

    it("ignores stale save completions", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed\n")
        store.set(startEditSaveAtom, "current-request")
        const before = store.get(driveEditBufferAtom)

        store.set(editSaveSucceededAtom, "stale-request")
        store.set(editSaveFailedAtom, {requestId: "stale-request", message: "stale"})
        store.set(markEditConflictAtom, {
            requestId: "stale-request",
            reason: "changed",
            theirMtime: 200,
        })

        expect(store.get(driveEditBufferAtom)).toEqual(before)
    })

    it("exits on success and preserves the exact draft on failure", () => {
        const successfulStore = createStore()
        open(successfulStore)
        setDraft(successfulStore, "changed\n")
        successfulStore.set(startEditSaveAtom, "save-a")
        successfulStore.set(editSaveSucceededAtom, "save-a")
        expect(successfulStore.get(driveEditBufferAtom)).toBeNull()

        const failedStore = createStore()
        open(failedStore)
        setDraft(failedStore, "changed\nwith trailing newline\n")
        failedStore.set(startEditSaveAtom, "save-b")
        failedStore.set(editSaveFailedAtom, {requestId: "save-b", message: "mount rejected"})
        expect(failedStore.get(driveEditBufferAtom)).toMatchObject({
            draft: "changed\nwith trailing newline\n",
            saveStatus: "idle",
            inflightRequestId: null,
            issue: {kind: "error", message: "mount rejected"},
        })
    })

    it("keeps one issue slot when conflict and error actions replace each other", () => {
        const store = createStore()
        const buffer = open(store)
        store.set(driveEditBufferAtom, {
            ...buffer,
            saveStatus: "saving",
            inflightRequestId: "conflict-request",
            issue: {kind: "error", message: "old error"},
        })
        store.set(markEditConflictAtom, {
            requestId: "conflict-request",
            reason: "changed",
            theirMtime: 200,
        })
        expect(store.get(driveEditBufferAtom)?.issue).toEqual({
            kind: "conflict",
            reason: "changed",
            theirMtime: 200,
        })

        store.set(driveEditBufferAtom, {
            ...(store.get(driveEditBufferAtom) as DriveEditBuffer),
            saveStatus: "saving",
            inflightRequestId: "error-request",
        })
        store.set(editSaveFailedAtom, {requestId: "error-request", message: "new error"})
        expect(store.get(driveEditBufferAtom)?.issue).toEqual({
            kind: "error",
            message: "new error",
        })
    })

    it("adopts only the matching reload and preserves the refreshed baseline", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed\n")
        store.set(startEditReloadAtom, "reload-a")

        store.set(replaceBufferFromRemoteAtom, {
            requestId: "stale-reload",
            content: "stale\n",
            mtime: 200,
        })
        expect(store.get(driveEditBufferAtom)?.draft).toBe("changed\n")

        store.set(replaceBufferFromRemoteAtom, {
            requestId: "reload-a",
            content: "remote\n",
            mtime: 300,
        })
        expect(store.get(driveEditBufferAtom)).toMatchObject({
            original: "remote\n",
            draft: "remote\n",
            baseMtime: 300,
            reloading: false,
            issue: null,
        })
        expect(store.get(driveEditDirtyAtomFamily("drive-a"))).toBe(false)
    })

    it("records reload failure without manufacturing a save request", () => {
        const store = createStore()
        open(store)
        store.set(startEditReloadAtom, "reload-a")

        store.set(editReloadFailedAtom, {requestId: "reload-a", message: "reload failed"})

        expect(store.get(driveEditBufferAtom)).toMatchObject({
            saveStatus: "idle",
            inflightRequestId: null,
            reloading: false,
            inflightReloadRequestId: null,
            issue: {kind: "error", message: "reload failed"},
        })
    })

    it("records a blocked navigation attempt while saving", () => {
        const store = createStore()
        open(store)
        setDraft(store, "changed")
        store.set(startEditSaveAtom, "save-a")

        store.set(markNavigationBlockedWhileSavingAtom, "drive-a")

        expect(store.get(driveEditBufferAtom)?.navigationBlockedWhileSaving).toBe(true)
    })

    it("shows the teardown notice with an honest field name", () => {
        const store = createStore()
        open(store, {scope: "session"})

        store.set(showTeardownNoticeAtom, "drive-a")

        expect(store.get(driveEditBufferAtom)?.showTeardownNotice).toBe(true)
    })
})
