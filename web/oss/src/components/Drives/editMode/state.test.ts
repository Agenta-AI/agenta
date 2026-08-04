import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    driveEditBufferAtom,
    driveEditFacetsAtom,
    editSaveFailedAtom,
    editSaveSucceededAtom,
    markEditConflictAtom,
    markTeardownWarnedAtom,
    openEditBufferAtom,
    overwriteNextSaveAtom,
    replaceBufferFromRemoteAtom,
    requestNavigationAtom,
    resolveNavigationAtom,
    setEditDraftAtom,
    setEditorViewAtom,
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
    mode: "code",
    language: "code",
}

const open = (
    store: ReturnType<typeof createStore>,
    overrides: Partial<OpenDriveEditBufferInput> = {},
) => {
    store.set(openEditBufferAtom, {...baseInput, ...overrides})
    return store.get(driveEditBufferAtom)!
}

const makeDirty = (store: ReturnType<typeof createStore>) => {
    store.set(setEditDraftAtom, "changed\n")
}

describe("drive edit state", () => {
    it("opens clean, becomes dirty after an edit, and becomes clean after restoring the original", () => {
        const store = createStore()
        open(store)

        expect(store.get(driveEditBufferAtom)?.draft).toBe("original\n")
        expect(store.get(driveEditFacetsAtom)).toMatchObject({
            editing: true,
            dirty: false,
            saving: false,
            guardOpen: false,
        })

        store.set(setEditDraftAtom, "changed\n")
        expect(store.get(driveEditFacetsAtom).dirty).toBe(true)

        store.set(setEditDraftAtom, "original\n")
        expect(store.get(driveEditFacetsAtom).dirty).toBe(false)
    })

    it("updates the editor view without changing another facet", () => {
        const store = createStore()
        open(store, {mode: "markdown"})

        store.set(setEditorViewAtom, "preview")

        expect(store.get(driveEditFacetsAtom)).toMatchObject({
            editing: true,
            dirty: false,
            mode: "markdown",
            editorView: "preview",
        })
    })

    it("runs clean navigation immediately and clears the buffer", () => {
        const store = createStore()
        open(store)
        const intent: NavigationIntent = {kind: "select", path: "other.txt"}

        expect(store.set(requestNavigationAtom, intent)).toEqual(intent)
        expect(store.get(driveEditBufferAtom)).toBeNull()
    })

    it("guards dirty navigation and records the pending intent", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        const intent: NavigationIntent = {kind: "close"}

        expect(store.set(requestNavigationAtom, intent)).toBeNull()
        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toEqual(intent)
        expect(store.get(driveEditFacetsAtom).guardOpen).toBe(true)
    })

    it("guards navigation when an issue exists even if the draft is clean", () => {
        const store = createStore()
        open(store)
        store.set(startEditSaveAtom, "request-a")
        store.set(editSaveFailedAtom, {requestId: "request-a", message: "rejected"})

        expect(store.set(requestNavigationAtom, {kind: "cancel"})).toBeNull()
        expect(store.get(driveEditBufferAtom)?.pendingNavigation).toEqual({kind: "cancel"})
    })

    it("keeps the buffer and only clears pending navigation", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        store.set(requestNavigationAtom, {kind: "close"})
        const before = store.get(driveEditBufferAtom)!

        expect(store.set(resolveNavigationAtom, "keep")).toBeNull()
        expect(store.get(driveEditBufferAtom)).toEqual({...before, pendingNavigation: null})
    })

    it.each<NavigationIntent>([
        {kind: "close"},
        {kind: "cancel"},
        {kind: "select", path: "other.txt"},
    ])("discards the buffer before running $kind navigation", (intent) => {
        const store = createStore()
        open(store)
        makeDirty(store)
        store.set(requestNavigationAtom, intent)

        expect(store.set(resolveNavigationAtom, "discard")).toEqual(intent)
        expect(store.get(driveEditBufferAtom)).toBeNull()
    })

    it("keeps the buffer open when discarding into a reload", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        const intent: NavigationIntent = {kind: "reload"}
        store.set(requestNavigationAtom, intent)

        expect(store.set(resolveNavigationAtom, "discard")).toEqual(intent)
        expect(store.get(driveEditBufferAtom)).toMatchObject({
            bufferId: "buffer-a",
            draft: "changed\n",
            pendingNavigation: null,
        })
    })

    it("ignores draft changes while saving", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        const before = store.get(driveEditBufferAtom)
        store.set(startEditSaveAtom, "request-a")

        store.set(setEditDraftAtom, "typed during save")

        expect(store.get(driveEditBufferAtom)?.draft).toBe(before?.draft)
    })

    it("ignores stale success, failure, and conflict completions", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        store.set(startEditSaveAtom, "current-request")
        const before = store.get(driveEditBufferAtom)

        store.set(editSaveSucceededAtom, "stale-request")
        expect(store.get(driveEditBufferAtom)).toEqual(before)
        store.set(editSaveFailedAtom, {requestId: "stale-request", message: "stale"})
        expect(store.get(driveEditBufferAtom)).toEqual(before)
        store.set(markEditConflictAtom, {
            requestId: "stale-request",
            reason: "changed",
            theirMtime: 200,
        })
        expect(store.get(driveEditBufferAtom)).toEqual(before)
    })

    it("ignores completions after the buffer was replaced", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        store.set(startEditSaveAtom, "request-a")
        store.set(driveEditBufferAtom, null)
        open(store, {
            bufferId: "buffer-b",
            targetPath: "other.txt",
            displayPath: "other.txt",
            original: "other",
        })
        const replacement = store.get(driveEditBufferAtom)

        store.set(editSaveSucceededAtom, "request-a")
        store.set(editSaveFailedAtom, {requestId: "request-a", message: "late"})
        store.set(markEditConflictAtom, {
            requestId: "request-a",
            reason: "missing",
            theirMtime: null,
        })

        expect(store.get(driveEditBufferAtom)).toEqual(replacement)
    })

    it("exits edit mode after the current save succeeds", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        store.set(startEditSaveAtom, "request-a")

        store.set(editSaveSucceededAtom, "request-a")

        expect(store.get(driveEditBufferAtom)).toBeNull()
        expect(store.get(driveEditFacetsAtom).editing).toBe(false)
    })

    it("preserves the exact draft after the current save fails", () => {
        const store = createStore()
        open(store)
        store.set(setEditDraftAtom, "changed\nwith trailing newline\n")
        const draft = store.get(driveEditBufferAtom)?.draft
        store.set(startEditSaveAtom, "request-a")

        store.set(editSaveFailedAtom, {requestId: "request-a", message: "mount rejected"})

        expect(store.get(driveEditBufferAtom)).toMatchObject({
            draft,
            saveStatus: "idle",
            inflightRequestId: null,
            issue: {kind: "error", message: "mount rejected"},
        })
    })

    it("uses one issue slot when conflict and error actions replace each other", () => {
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

    it("arms one overwrite and clears the flag when the next save starts", () => {
        const store = createStore()
        const buffer = open(store)
        store.set(driveEditBufferAtom, {
            ...buffer,
            issue: {kind: "conflict", reason: "changed", theirMtime: 200},
        })

        store.set(overwriteNextSaveAtom)
        expect(store.get(driveEditBufferAtom)).toMatchObject({
            issue: null,
            skipConflictCheckOnce: true,
        })

        store.set(startEditSaveAtom, "overwrite-request")
        expect(store.get(driveEditBufferAtom)).toMatchObject({
            saveStatus: "saving",
            inflightRequestId: "overwrite-request",
            skipConflictCheckOnce: false,
        })
    })

    it("replaces the baseline from remote and leaves a clean buffer open", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        store.set(startEditSaveAtom, "request-a")
        store.set(editSaveFailedAtom, {requestId: "request-a", message: "rejected"})

        store.set(replaceBufferFromRemoteAtom, {content: "remote\n", mtime: 300})

        expect(store.get(driveEditBufferAtom)).toMatchObject({
            original: "remote\n",
            draft: "remote\n",
            baseMtime: 300,
            issue: null,
        })
        expect(store.get(driveEditFacetsAtom)).toMatchObject({editing: true, dirty: false})
    })

    it("keeps exactly one buffer until guarded selection is discarded", () => {
        const store = createStore()
        open(store)
        makeDirty(store)
        const intent: NavigationIntent = {kind: "select", path: "second.txt"}
        store.set(requestNavigationAtom, intent)

        store.set(openEditBufferAtom, {
            ...baseInput,
            bufferId: "buffer-b",
            targetPath: "second.txt",
            displayPath: "second.txt",
        })
        expect(store.get(driveEditBufferAtom)).toMatchObject({
            bufferId: "buffer-a",
            pendingNavigation: intent,
        })

        expect(store.set(resolveNavigationAtom, "discard")).toEqual(intent)
        expect(store.get(driveEditBufferAtom)).toBeNull()
    })

    it("marks the teardown warning and closes explicitly", () => {
        const store = createStore()
        open(store, {scope: "session"})

        store.set(markTeardownWarnedAtom)
        expect(store.get(driveEditBufferAtom)?.teardownWarned).toBe(true)

        store.set(driveEditBufferAtom, null)
        expect(store.get(driveEditBufferAtom)).toBeNull()
    })
})
